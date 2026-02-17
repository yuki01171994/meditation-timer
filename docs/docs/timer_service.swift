import Foundation

@MainActor
final class TimerService: ObservableObject {

    enum TimerState {
        case idle
        case running
        case paused
        case completedHolding
    }

    @Published private(set) var remainingSeconds: Int = 0
    @Published private(set) var state: TimerState = .idle

    private var endDate: Date?
    private var pauseDate: Date?
    private var tickTimer: Timer?
    private var holdTask: Task<Void, Never>?

    private let completionHoldSeconds: UInt64 = 3

    var onCompleted: (() -> Void)?

    func start(durationSeconds: Int) {
        guard durationSeconds > 0 else { return }

        cleanupTimers()
        remainingSeconds = durationSeconds
        endDate = Date().addingTimeInterval(TimeInterval(durationSeconds))
        pauseDate = nil
        state = .running

        startTicking()
    }

    func pause() {
        guard state == .running else { return }
        pauseDate = Date()
        stopTicking()
        state = .paused
    }

    func resume() {
        guard state == .paused, let pauseDate, let endDate else { return }

        let pausedDuration = Date().timeIntervalSince(pauseDate)
        self.endDate = endDate.addingTimeInterval(pausedDuration)
        self.pauseDate = nil
        state = .running

        startTicking()
    }

    func cancel() {
        cleanupTimers()
        state = .idle
        remainingSeconds = 0
        endDate = nil
        pauseDate = nil
    }

    private func startTicking() {
        stopTicking()
        tickTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.updateRemaining()
            }
        }
    }

    private func stopTicking() {
        tickTimer?.invalidate()
        tickTimer = nil
    }

    private func cleanupTimers() {
        stopTicking()
        holdTask?.cancel()
        holdTask = nil
    }

    private func updateRemaining() {
        guard state == .running, let endDate else { return }

        let secondsLeft = Int(ceil(endDate.timeIntervalSinceNow))

        if secondsLeft <= 0 {
            completeAndHold()
        } else {
            remainingSeconds = secondsLeft
        }
    }

    private func completeAndHold() {
        stopTicking()
        remainingSeconds = 0
        state = .completedHolding

        onCompleted?()

        holdTask?.cancel()
        holdTask = Task { [completionHoldSeconds] in
            try? await Task.sleep(nanoseconds: completionHoldSeconds * 1_000_000_000)
            await MainActor.run {
                self.state = .idle
                self.endDate = nil
                self.pauseDate = nil
            }
        }
    }
}
