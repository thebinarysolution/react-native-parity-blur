package com.parityblur

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Loads `test/pipeline-fixtures.json` (the language-neutral fixture table shared with the JS
 * suite, docs/PIPELINE_SPEC.md §11) and asserts every [PipelineMath] / [AndroidBlurCalibration]
 * function matches it within 1e-6, per this milestone's required-tests brief.
 *
 * `parseColor` fixtures are intentionally NOT asserted here: Android's `overlayColor` native prop
 * arrives already parsed into an ARGB Int by React Native's own color parser (see
 * ParityBlurViewNativeComponent.ts), so there is no Kotlin string-color-parsing step to mirror
 * (see the deviation note atop PipelineMath.kt).
 */
class PipelineFixturesTest {

  private val fixtures: Map<String, Any?> by lazy {
    val file = locateFixturesFile()
    MiniJson.parse(file.readText()).asJsonObject()
  }

  private val TOL = 1e-6

  private fun rows(name: String): List<Map<String, Any?>> =
    (fixtures[name] ?: error("Missing fixture group '$name'"))
      .asJsonArray()
      .map { it.asJsonObject() }

  private fun rectOf(map: Map<String, Any?>): PipelineMath.Rect = PipelineMath.Rect(
    x = map.getValue("x").asJsonDouble(),
    y = map.getValue("y").asJsonDouble(),
    width = map.getValue("width").asJsonDouble(),
    height = map.getValue("height").asJsonDouble()
  )

  private fun assertRectEquals(expected: PipelineMath.Rect, actual: PipelineMath.Rect, label: String) {
    assertEquals("$label.x", expected.x, actual.x, TOL)
    assertEquals("$label.y", expected.y, actual.y, TOL)
    assertEquals("$label.width", expected.width, actual.width, TOL)
    assertEquals("$label.height", expected.height, actual.height, TOL)
  }

  // ------------------------------------------------------------------------------ units.ts

  @Test
  fun sigmaPxFromDp() {
    for (row in rows("sigmaPxFromDp")) {
      val actual = PipelineMath.sigmaPxFromDp(
        row.getValue("blurRadiusDp").asJsonDouble(),
        row.getValue("displayScale").asJsonDouble()
      )
      assertEquals(row.toString(), row.getValue("expected").asJsonDouble(), actual, TOL)
    }
  }

  @Test
  fun sigmaSnapshotFromPx() {
    for (row in rows("sigmaSnapshotFromPx")) {
      val actual = PipelineMath.sigmaSnapshotFromPx(
        row.getValue("sigmaPx").asJsonDouble(),
        row.getValue("downsample").asJsonInt()
      )
      assertEquals(row.toString(), row.getValue("expected").asJsonDouble(), actual, TOL)
    }
  }

  // ----------------------------------------------------------------- androidCalibration.ts

  @Test
  fun radiusForSigma() {
    for (row in rows("radiusForSigma")) {
      val expected = row.getValue("expected").asJsonObject()
      val actual = AndroidBlurCalibration.radiusForSigma(row.getValue("sigmaSnapshot").asJsonDouble())
      assertEquals("$row noBlur", expected.getValue("noBlur").asJsonBoolean(), actual.noBlur)
      assertEquals(
        "$row radiusPlatform",
        expected.getValue("radiusPlatform").asJsonDouble(),
        actual.radiusPlatform,
        TOL
      )
    }
  }

  // --------------------------------------------------------------------- downsample.ts

  @Test
  fun autoDownsample() {
    for (row in rows("autoDownsample")) {
      val actual = PipelineMath.autoDownsample(
        row.getValue("sigmaPx").asJsonDouble(),
        row.getValue("captureAreaPx").asJsonDouble(),
        row.getValue("quality").asJsonString()
      )
      assertEquals(row.toString(), row.getValue("expected").asJsonInt(), actual)
    }
  }

  // -------------------------------------------------------------------- captureRect.ts

  @Test
  fun supportMarginPx() {
    for (row in rows("supportMarginPx")) {
      val actual = PipelineMath.supportMarginPx(row.getValue("sigmaPx").asJsonDouble())
      assertEquals(row.toString(), row.getValue("expected").asJsonDouble(), actual, TOL)
    }
  }

  @Test
  fun expandCaptureRect() {
    for (row in rows("expandCaptureRect")) {
      val actual = PipelineMath.expandCaptureRect(
        rectOf(row.getValue("visibleRect").asJsonObject()),
        rectOf(row.getValue("targetBounds").asJsonObject()),
        row.getValue("sigmaPx").asJsonDouble()
      )
      assertRectEquals(rectOf(row.getValue("expected").asJsonObject()), actual, row.toString())
    }
  }

  @Test
  fun snapshotRectFor() {
    for (row in rows("snapshotRectFor")) {
      val actual = PipelineMath.snapshotRectFor(
        rectOf(row.getValue("captureRectPx").asJsonObject()),
        row.getValue("downsample").asJsonInt()
      )
      assertRectEquals(rectOf(row.getValue("expected").asJsonObject()), actual, row.toString())
    }
  }

  @Test
  fun cropRectFor() {
    for (row in rows("cropRectFor")) {
      val downsample = row.getValue("downsample").asJsonInt()
      // The fixture provides captureRectPx (not the intermediate snapshotRect); derive the
      // snapshot rect first exactly as the real pipeline sequences it (expand -> snapshotRectFor
      // -> cropRectFor -- see PipelineMath.kt / captureRect.ts buildCapturePlan).
      val snapshotRect = PipelineMath.snapshotRectFor(
        rectOf(row.getValue("captureRectPx").asJsonObject()),
        downsample
      )
      val actual = PipelineMath.cropRectFor(
        rectOf(row.getValue("visibleRect").asJsonObject()),
        snapshotRect,
        downsample
      )
      assertRectEquals(rectOf(row.getValue("expected").asJsonObject()), actual, row.toString())
    }
  }

  // -------------------------------------------------------------------- saturation.ts

  @Test
  fun saturationMatrix() {
    for (row in rows("saturationMatrix")) {
      val expected = row.getValue("expected").asJsonArray().map { it.asJsonDouble() }
      val actual = PipelineMath.saturationMatrix(row.getValue("s").asJsonDouble())
      assertEquals(20, expected.size)
      assertEquals(20, actual.size)
      for (i in 0 until 20) {
        assertEquals("$row [$i]", expected[i], actual[i], TOL)
      }
    }
  }

  // ----------------------------------------------------------------------- overlay.ts

  @Test
  fun sourceOver() {
    for (row in rows("sourceOver")) {
      fun rgba(key: String): PipelineMath.RGBA {
        val m = row.getValue(key).asJsonObject()
        return PipelineMath.RGBA(
          m.getValue("r").asJsonDouble(),
          m.getValue("g").asJsonDouble(),
          m.getValue("b").asJsonDouble(),
          m.getValue("a").asJsonDouble()
        )
      }
      val expected = rgba("expected")
      val actual = PipelineMath.sourceOver(rgba("src"), rgba("dst"))
      assertEquals("$row r", expected.r, actual.r, TOL)
      assertEquals("$row g", expected.g, actual.g, TOL)
      assertEquals("$row b", expected.b, actual.b, TOL)
      assertEquals("$row a", expected.a, actual.a, TOL)
    }
  }

  // -------------------------------------------------------------------------- fixture lookup

  private fun locateFixturesFile(): File {
    val cwd = File(System.getProperty("user.dir") ?: ".").absoluteFile
    val candidates = LinkedHashSet<File>()
    candidates += File(cwd, "../test/pipeline-fixtures.json")
    candidates += File(cwd, "test/pipeline-fixtures.json")
    // Defensive fallback: walk upward from the working dir (bounded, not a filesystem scan)
    // in case the test task's working directory differs from the usual module dir.
    var dir: File? = cwd
    var steps = 0
    while (dir != null && steps < 6) {
      candidates += File(dir, "test/pipeline-fixtures.json")
      dir = dir.parentFile
      steps++
    }
    for (candidate in candidates) {
      val resolved = runCatching { candidate.canonicalFile }.getOrNull() ?: continue
      if (resolved.isFile) return resolved
    }
    throw AssertionError(
      "Could not locate test/pipeline-fixtures.json (cwd=$cwd). Checked: " +
        candidates.joinToString { it.path }
    )
  }

  @Test
  fun fixtureFileIsFound() {
    assertTrue(locateFixturesFile().isFile)
  }
}
