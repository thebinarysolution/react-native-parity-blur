import Foundation
import UIKit

/// Per-window active-view registry + capture scheduling (plan §15.2, §20, §21, §39).
///
/// STATIC mode: capture requests coalesce to ONE capture per view on the next main-runloop
/// turn (plan §29, §45.8).
///
/// LIVE mode (Milestone 6): ONE shared CADisplayLink per window — never one per view (plan
/// §45.6) — created when the first live view registers and torn down when the last leaves
/// (plan §24/§27: zero frame work while no live blur is visible). Each tick filters by the
/// visibility heuristic and each view's own maxFps throttle + in-flight backpressure
/// (plan §21/§22: at most 1 in-flight GPU pass per view, latest-wins, stale frames dropped).
/// The link pauses while the app is inactive (plan §21 app/scene lifecycle pause).
final class WindowBlurContext {

  /// Attached ParityBlur core views in this window (weak bookkeeping).
  private let activeViews = NSHashTable<ParityBlurCoreView>.weakObjects()

  private var pendingCaptures = NSHashTable<ParityBlurCoreView>.weakObjects()
  private var flushScheduled = false

  // ------------------------------------------------------------------- live (Milestone 6)

  private let liveViews = NSHashTable<ParityBlurCoreView>.weakObjects()
  private var displayLink: CADisplayLink?
  private var lifecycleObservers: [NSObjectProtocol] = []

  /// CADisplayLink retains its target; this proxy breaks the cycle so the context (and its
  /// window) can deallocate naturally.
  private final class LinkProxy {
    weak var context: WindowBlurContext?
    init(_ c: WindowBlurContext) { context = c }
    @objc func tick(_ link: CADisplayLink) { context?.liveTick(link) }
  }

  deinit {
    displayLink?.invalidate()
    for o in lifecycleObservers { NotificationCenter.default.removeObserver(o) }
  }

  func register(_ view: ParityBlurCoreView) {
    activeViews.add(view)
  }

  func unregister(_ view: ParityBlurCoreView) {
    activeViews.remove(view)
    pendingCaptures.remove(view)
    unregisterLive(view)
  }

  func registerLive(_ view: ParityBlurCoreView) {
    liveViews.add(view)
    ensureDisplayLink()
  }

  func unregisterLive(_ view: ParityBlurCoreView) {
    liveViews.remove(view)
    if liveViews.count == 0 {
      displayLink?.invalidate()
      displayLink = nil
      ParityBlurDebug.log("scheduler-uninstall window=\(ObjectIdentifier(self))")
    }
  }

  private func ensureDisplayLink() {
    guard displayLink == nil else { return }
    let link = CADisplayLink(target: LinkProxy(self), selector: #selector(LinkProxy.tick(_:)))
    // Cap the link at the highest maxFps among live views; per-view throttles refine below it.
    let cap = Float(liveViews.allObjects.map(\.maxFps).max() ?? 30)
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 10, maximum: cap, preferred: cap)
    link.add(to: .main, forMode: .common)
    displayLink = link
    ParityBlurDebug.log("scheduler-install window=\(ObjectIdentifier(self))")

    if lifecycleObservers.isEmpty {
      let nc = NotificationCenter.default
      lifecycleObservers.append(nc.addObserver(
        forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in self?.displayLink?.isPaused = true })
      lifecycleObservers.append(nc.addObserver(
        forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in self?.displayLink?.isPaused = false })
    }
  }

  private func liveTick(_ link: CADisplayLink) {
    let now = link.timestamp
    for view in liveViews.allObjects where view.isLiveEligible(now: now) {
      view.performLiveTick(now: now)
    }
  }

  /// Coalesce a static capture request to the next main-runloop turn (plan §20).
  func scheduleCapture(_ view: ParityBlurCoreView) {
    pendingCaptures.add(view)
    guard !flushScheduled else { return }
    flushScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.flushScheduled = false
      let batch = self.pendingCaptures.allObjects
      self.pendingCaptures.removeAllObjects()
      for v in batch where v.window != nil {
        v.performScheduledCapture()
      }
    }
  }

  var isEmpty: Bool { activeViews.count == 0 }
}
