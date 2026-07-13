#!/usr/bin/env python3
"""
Milestone 5 (Parity Calibration) — ANALYSIS stage.

Compares Android (Pixel 6a) vs iOS (iPhone 14 Pro) blur captures for
react-native-parity-blur, per docs/PIPELINE_SPEC.md and the M5 analysis brief.

This script ONLY analyzes; it does not modify library source. It writes numbers
to stdout; the human-readable report lives in docs/CALIBRATION_REPORT.md.

Requires: PIL, numpy. No network, no new installs.
"""
import os
import sys
import json
import numpy as np
from PIL import Image

CALIB = ("/private/tmp/claude-501/-Volumes-Samsung-PROJECTS-NATIVE-BLUR/"
         "16abde4b-ef7f-4e23-884d-936b0933560b/scratchpad/calib")

DENS = {"android": 2.625, "ios": 3.0}
RADII = [4, 8, 16, 24, 32]           # dp gaussian sigma per strip
STRIP_TOP_DP = [120 + 136 * i for i in range(5)]
STRIP_H_DP = 96
GRID_W = 360                         # common resample width (dp units -> px cells)
GRID_H = 96
METRIC_X0 = 100                      # exclude labels (x < 100dp)
FIXTURES = ["bw", "rg", "by", "checkerboard", "photo", "alpha"]

# gap (unblurred) reference bands, dp, between strips
GAP_BANDS_DP = [(220, 252), (356, 388), (492, 524), (628, 660)]


def load_rgb(plat, fix, variant):
    p = os.path.join(CALIB, f"{plat}-{fix}-{variant}.png")
    return np.asarray(Image.open(p).convert("RGB")).astype(np.float32)


# ----- color management -------------------------------------------------------
def check_icc():
    """Report embedded ICC profiles. iOS screenshots are expected P3-tagged."""
    out = {}
    for f in sorted(os.listdir(CALIB)):
        if not f.endswith(".png"):
            continue
        icc = Image.open(os.path.join(CALIB, f)).info.get("icc_profile")
        out[f] = len(icc) if icc else 0
    return out


def gap_validation():
    """After (no) normalization, unblurred gap means must match Android within a
    few /255 on every fixture. Also flags fixture-content mismatches (a corrupt
    capture shows up as a large gap delta AND anomalous gap stddev)."""
    rows = []
    for fix in FIXTURES:
        for variant in ["clear"]:
            a = load_rgb("android", fix, variant)
            i = load_rgb("ios", fix, variant)
            am, ims_, astd = [], [], []
            for (y0, y1) in GAP_BANDS_DP:
                ax0, ax1 = int(METRIC_X0 * DENS["android"]), int(360 * DENS["android"])
                ix0, ix1 = int(METRIC_X0 * DENS["ios"]), int(360 * DENS["ios"])
                ab = a[int(y0 * DENS["android"]):int(y1 * DENS["android"]), ax0:ax1].reshape(-1, 3)
                ib = i[int(y0 * DENS["ios"]):int(y1 * DENS["ios"]), ix0:ix1].reshape(-1, 3)
                am.append(ab.mean(0)); ims_.append(ib.mean(0))
                astd.append(ab.std());
            am = np.mean(am, 0); ims_ = np.mean(ims_, 0)
            rows.append({
                "fixture": fix,
                "android_gap_mean": am.round(1).tolist(),
                "ios_gap_mean": ims_.round(1).tolist(),
                "delta": (ims_ - am).round(1).tolist(),
                "max_abs_delta": float(np.abs(ims_ - am).max().round(2)),
            })
    return rows


# ----- geometry / resampling --------------------------------------------------
def strip_grid(img, plat, i, gray=False):
    """Return a GRID_W x GRID_H box-filtered resample of strip i,
    x in [0,360)dp, y in [top,top+96)dp."""
    d = DENS[plat]
    top = STRIP_TOP_DP[i]
    y0, y1 = int(round(top * d)), int(round((top + STRIP_H_DP) * d))
    x0, x1 = 0, int(round(GRID_W * d))
    crop = Image.fromarray(img[y0:y1, x0:x1].astype(np.uint8))
    crop = crop.resize((GRID_W, GRID_H), Image.BOX)
    arr = np.asarray(crop).astype(np.float32)
    if gray:
        return luma(arr)
    return arr


def luma(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


# ----- color science ----------------------------------------------------------
def srgb_to_lab(rgb):
    """rgb 0-255 -> CIELAB (D65). rgb may be (...,3)."""
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805],
                  [0.2126, 0.7152, 0.0722],
                  [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T
    white = np.array([0.95047, 1.0, 1.08883])
    xyz = xyz / white
    e, k = 216 / 24389, 24389 / 27
    f = np.where(xyz > e, np.cbrt(xyz), (k * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1)


def deltaE76(rgb1, rgb2):
    l1, l2 = srgb_to_lab(rgb1), srgb_to_lab(rgb2)
    return float(np.sqrt(((l1 - l2) ** 2).sum()))


def global_ssim(x, y):
    """Global (single-window) SSIM on two grayscale arrays, standard constants."""
    x = x.astype(np.float64); y = y.astype(np.float64)
    C1 = (0.01 * 255) ** 2; C2 = (0.03 * 255) ** 2
    mx, my = x.mean(), y.mean()
    vx, vy = x.var(), y.var()
    cxy = ((x - mx) * (y - my)).mean()
    return float(((2 * mx * my + C1) * (2 * cxy + C2)) /
                 ((mx ** 2 + my ** 2 + C1) * (vx + vy + C2)))


# ----- crossing helper for edge analysis --------------------------------------
def crossings(x_dp, prof, lo, hi):
    """Return dp positions where prof crosses 25/50/75% between lo..hi levels."""
    res = {}
    for frac, tag in [(0.25, "p25"), (0.5, "p50"), (0.75, "p75")]:
        thr = lo + frac * (hi - lo)
        pos = None
        for j in range(1, len(prof)):
            if (prof[j - 1] - thr) * (prof[j] - thr) <= 0 and prof[j] != prof[j - 1]:
                t = (thr - prof[j - 1]) / (prof[j] - prof[j - 1])
                pos = x_dp[j - 1] + t * (x_dp[j] - x_dp[j - 1])
                break
        res[tag] = pos
    return res


# ----- tint math (spec §7-§8) -------------------------------------------------
def apply_saturation(rgb, s):
    lr, lg, lb = 0.2126, 0.7152, 0.0722
    t = 1 - s
    c = rgb / 255.0
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    o = np.stack([
        (t * lr + s) * r + (t * lg) * g + (t * lb) * b,
        (t * lr) * r + (t * lg + s) * g + (t * lb) * b,
        (t * lr) * r + (t * lg) * g + (t * lb + s) * b,
    ], -1)
    return np.clip(o, 0, 1) * 255.0


def apply_overlay(rgb, oc_rgb, oa):
    """source-over, dstA=1: outC = srcC*srcA + dstC*(1-srcA)."""
    src = np.array(oc_rgb, np.float32)
    return src * oa + rgb * (1 - oa)


def predict_tinted(clear_rgb, s=1.4, oc=(16, 16, 16), oa=0.35):
    return apply_overlay(apply_saturation(clear_rgb, s), oc, oa)


# =============================================================================
def main():
    report = {}
    report["icc"] = check_icc()
    report["gap_validation"] = gap_validation()

    # detect corrupt captures: gap band stddev of a fixture that should be
    # high-contrast (checkerboard) collapsing indicates wrong fixture content.
    corrupt = []
    for fix in FIXTURES:
        for plat in ["android", "ios"]:
            for variant in ["clear", "tinted"]:
                img = load_rgb(plat, fix, variant)
                d = DENS[plat]
                band = img[int(220 * d):int(252 * d),
                           int(120 * d):int(360 * d)].reshape(-1, 3)
                std = float(band.std())
                if fix == "checkerboard" and std < 60:
                    corrupt.append(f"{plat}-{fix}-{variant} (gap std={std:.1f}, expected ~120)")
    report["corrupt_captures"] = corrupt

    # -------- per fixture x strip metrics --------
    per = {}
    for fix in FIXTURES:
        for variant in ["clear", "tinted"]:
            a_img = load_rgb("android", fix, variant)
            i_img = load_rgb("ios", fix, variant)
            key = f"{fix}-{variant}"
            skip = f"ios-checkerboard-clear" if (fix == "checkerboard" and variant == "clear") else None
            rows = []
            for i in range(5):
                ag = strip_grid(a_img, "android", i)
                ig = strip_grid(i_img, "ios", i)
                # metric region x>=100dp -> cols >= 100
                agm = ag[:, METRIC_X0:, :]
                igm = ig[:, METRIC_X0:, :]
                a_mean = agm.reshape(-1, 3).mean(0)
                i_mean = igm.reshape(-1, 3).mean(0)
                dE = deltaE76(a_mean, i_mean)
                # luminance profile per column
                a_prof = luma(agm).mean(0)   # length 260
                i_prof = luma(igm).mean(0)
                mae = float(np.abs(a_prof - i_prof).mean())
                maxe = float(np.abs(a_prof - i_prof).max())
                ssim = global_ssim(luma(agm), luma(igm))
                rows.append({
                    "strip": i, "sigma_dp": RADII[i],
                    "android_mean": a_mean.round(1).tolist(),
                    "ios_mean": i_mean.round(1).tolist(),
                    "dRGB": (i_mean - a_mean).round(1).tolist(),
                    "deltaE76": round(dE, 2),
                    "prof_mae": round(mae, 2),
                    "prof_maxe": round(maxe, 2),
                    "ssim": round(ssim, 4),
                    "invalid": bool(skip),
                })
            per[key] = rows
    report["per_strip"] = per

    # -------- gamma-domain verdict (checkerboard strip4) --------
    gamma = {}
    for plat in ["android", "ios"]:
        img = load_rgb(plat, "checkerboard", "clear")
        g = strip_grid(img, plat, 4)          # strip4 = 32dp fully smoothed
        interior = luma(g[:, METRIC_X0:])
        gamma[plat + "_clear_strip4_mean"] = round(float(interior.mean()), 1)
    # iOS clear checkerboard is corrupt -> cross-check via tinted strip4:
    # predicted interior if gamma(127.5) vs linear(187) after tint math.
    for plat in ["android", "ios"]:
        img = load_rgb(plat, "checkerboard", "tinted")
        g = strip_grid(img, plat, 4)
        interior = luma(g[:, METRIC_X0:])
        gamma[plat + "_tinted_strip4_mean"] = round(float(interior.mean()), 1)
    # references: tint applied to a flat gray field of value v (gray stays gray
    # under saturation), overlay (16,0.35): out = 16*0.35 + v*0.65
    gamma["tinted_pred_if_gamma127.5"] = round(16 * 0.35 + 127.5 * 0.65, 1)
    gamma["tinted_pred_if_linear187"] = round(16 * 0.35 + 187.0 * 0.65, 1)
    report["gamma"] = gamma

    # -------- edge behavior (alpha fixture) --------
    edge = {}
    for i in range(5):
        e = {}
        for plat in ["android", "ios"]:
            img = load_rgb(plat, "alpha", "clear")
            d = DENS[plat]
            top = STRIP_TOP_DP[i]
            y0, y1 = int(top * d), int((top + STRIP_H_DP) * d)
            # boundary ~361dp: profile across x 320..400 dp
            xs = np.arange(int(320 * d), int(400 * d))
            prof = img[y0:y1, xs[0]:xs[-1] + 1].mean(axis=(0, 2))
            x_dp = xs / d
            cr = crossings(x_dp, prof, 0.0, 128.0)
            e[plat] = cr
        disp = {}
        for tag in ["p25", "p50", "p75"]:
            a, b = e["android"][tag], e["ios"][tag]
            disp[tag] = None if (a is None or b is None) else round(abs(a - b), 2)
        edge[f"strip{i}_sigma{RADII[i]}"] = {"crossings": e, "disp_dp": disp}
    report["edge"] = edge

    # -------- radius scaling (checkerboard contrast decay) --------
    # iOS clear is corrupt -> use TINTED checkerboard (identical overlay both
    # platforms, so the decay-vs-sigma shape is preserved) for cross-platform.
    radius = {"note": "uses checkerboard-TINTED (ios clear corrupt); overlay identical both platforms so contrast-decay shape preserved"}
    curves = {}
    for plat in ["android", "ios"]:
        img = load_rgb(plat, "checkerboard", "tinted")
        stds = []
        for i in range(5):
            g = strip_grid(img, plat, i)
            stds.append(round(float(luma(g[:, METRIC_X0:]).std()), 2))
        curves[plat] = stds
    radius["contrast_std_by_strip"] = curves
    # estimate sigma ratio: for each strip, contrast decays ~ with sigma. Find
    # multiplicative shift r such that ios_curve(sigma) ~ android_curve(sigma*r).
    # Fit on log(contrast) vs log(sigma) slope; ratio via horizontal offset.
    a_c = np.array(curves["android"]); i_c = np.array(curves["ios"])
    sig = np.array(RADII, float)
    # use strips where both have meaningful contrast (>1)
    m = (a_c > 1) & (i_c > 1)
    if m.sum() >= 2:
        # log-log linear fit contrast = k * sigma^p ; solve sigma_ratio from
        # requiring i_c(sig) = a_c(sig * ratio): in log space horizontal offset
        pa = np.polyfit(np.log(sig[m]), np.log(a_c[m]), 1)  # slope, intercept
        pi = np.polyfit(np.log(sig[m]), np.log(i_c[m]), 1)
        # ratio = exp((intercept_i - intercept_a)/slope_a) approx
        slope = pa[0]
        ratio = float(np.exp((pi[1] - pa[1]) / slope)) if abs(slope) > 1e-6 else float("nan")
        radius["loglog_slope_android"] = round(float(pa[0]), 3)
        radius["loglog_slope_ios"] = round(float(pi[0]), 3)
        radius["sigma_ratio_ios_over_android"] = round(ratio, 4)
    report["radius"] = radius

    # -------- tinted math residuals --------
    tint = {}
    for fix in FIXTURES:
        if fix == "checkerboard":
            continue  # high-freq; per-pixel tint != tint-of-mean, skip means test
        rows = []
        for plat in ["android", "ios"]:
            clear = load_rgb(plat, fix, "clear")
            tinted = load_rgb(plat, fix, "tinted")
            per_strip = []
            for i in range(5):
                gc = strip_grid(clear, plat, i)[:, METRIC_X0:].reshape(-1, 3).mean(0)
                gt = strip_grid(tinted, plat, i)[:, METRIC_X0:].reshape(-1, 3).mean(0)
                pred = predict_tinted(gc)
                resid = float(np.abs(pred - gt).max())
                per_strip.append(round(resid, 2))
            rows.append({plat: per_strip})
        tint[fix] = rows
    report["tint"] = tint

    # -------- noise floor from gap regions (for threshold proposal) --------
    floor = {}
    dEs, maes = [], []
    for fix in FIXTURES:
        a = load_rgb("android", fix, "clear"); i = load_rgb("ios", fix, "clear")
        if fix == "checkerboard":
            continue
        for (y0, y1) in GAP_BANDS_DP:
            ax0, ax1 = int(METRIC_X0 * DENS["android"]), int(360 * DENS["android"])
            ix0, ix1 = int(METRIC_X0 * DENS["ios"]), int(360 * DENS["ios"])
            am = a[int(y0 * 2.625):int(y1 * 2.625), ax0:ax1].reshape(-1, 3).mean(0)
            im = i[int(y0 * 3.0):int(y1 * 3.0), ix0:ix1].reshape(-1, 3).mean(0)
            dEs.append(deltaE76(am, im))
            maes.append(float(abs(luma(am[None])[0] - luma(im[None])[0])))
    floor["gap_deltaE76_max"] = round(max(dEs), 3)
    floor["gap_deltaE76_mean"] = round(float(np.mean(dEs)), 3)
    floor["gap_luma_mae_max"] = round(max(maes), 3)
    report["noise_floor"] = floor

    print(json.dumps(report, indent=2))
    # also persist for report authoring
    outp = os.path.join(os.path.dirname(__file__), "..", "docs", "_calibration_metrics.json")
    with open(os.path.abspath(outp), "w") as f:
        json.dump(report, f, indent=2)


if __name__ == "__main__":
    main()
