import AppKit
import ConversationIslandCore
import Foundation
import SwiftUI

private enum InputEvent: Sendable {
    case command(ParentCommand)
    case diagnostic(String)
    case endOfFile
}

private final class StandardInputReader: @unchecked Sendable {
    private let input: FileHandle
    private let queue = DispatchQueue(label: "conversation-island.stdin")
    private let onEvents: @Sendable ([InputEvent]) -> Void
    private var framer = JSONLineFramer()
    private var isStopped = false

    init(input: FileHandle = .standardInput, onEvents: @escaping @Sendable ([InputEvent]) -> Void) {
        self.input = input
        self.onEvents = onEvents
    }

    func start() {
        input.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            self?.queue.async { [weak self] in
                self?.consume(data)
            }
        }
    }

    func stop() {
        input.readabilityHandler = nil
        queue.async { [weak self] in
            self?.isStopped = true
        }
    }

    private func consume(_ data: Data) {
        guard !isStopped else {
            return
        }

        if data.isEmpty {
            isStopped = true
            input.readabilityHandler = nil
            var events = framer.finish().map(inputEvent)
            events.append(.endOfFile)
            onEvents(events)
            return
        }

        onEvents(framer.append(data).map(inputEvent))
    }

    private func inputEvent(_ frame: Result<Data, JSONLineFramingError>) -> InputEvent {
        switch frame {
        case let .success(data):
            do {
                return .command(try ParentCommand.decode(data: data))
            } catch let error as ConversationIslandProtocolError {
                var metadata = "protocol-error kind=\(error.kind.rawValue)"
                if let revision = error.revision {
                    metadata += " revision=\(revision)"
                }
                return .diagnostic(metadata)
            } catch {
                return .diagnostic("protocol-error kind=invalid-payload")
            }
        case let .failure(error):
            switch error {
            case .lineTooLong:
                return .diagnostic("framing-error kind=line-too-long")
            case .incompleteLine:
                return .diagnostic("framing-error kind=incomplete-line")
            }
        }
    }
}

@MainActor
final class HelperController {
    private let viewModel = IslandViewModel()
    private var session = SessionState()
    private var inputReader: StandardInputReader?
    private var screenObserver: NSObjectProtocol?
    private var expandWorkItem: DispatchWorkItem?
    private var collapseWorkItem: DispatchWorkItem?
    private var exitWorkItem: DispatchWorkItem?
    private var warnedDisplayIds = Set<Int64>()
    private var isTerminating = false

    private lazy var panel = IslandPanel(
        rootView: IslandView(
            viewModel: viewModel,
            onHoverChanged: { [weak self] revision, hovering in
                self?.handleHover(revision: revision, hovering: hovering)
            },
            onOpenActivity: { [weak self] revision, activityId in
                self?.openActivity(revision: revision, activityId: activityId)
            }
        )
    )

    func start() {
        _ = panel
        observeScreenChanges()

        let reader = StandardInputReader { [weak self] events in
            Task { @MainActor [weak self] in
                self?.handleInputEvents(events)
            }
        }
        inputReader = reader
        reader.start()
        send(.ready(pid: ProcessInfo.processInfo.processIdentifier))
    }

    func prepareForTermination() {
        inputReader?.stop()
        inputReader = nil
        stopHoverTimers()
        exitWorkItem?.cancel()
        exitWorkItem = nil
        removeScreenObserver()
        withAnimation(nil) {
            viewModel.setMotionTarget(.hidden)
            viewModel.hide()
        }
        panel.orderOut(nil)
    }

    private func handleInputEvents(_ events: [InputEvent]) {
        guard !isTerminating else {
            return
        }

        for event in events {
            switch event {
            case let .command(command):
                handle(command)
            case let .diagnostic(metadata):
                writeDiagnostic(metadata)
            case .endOfFile:
                perform(session.shutdown())
            }

            if isTerminating {
                return
            }
        }
    }

    private func handle(_ command: ParentCommand) {
        switch command {
        case let .present(revision, payload):
            perform(session.present(revision: revision, payload: payload))
        case let .dismiss(revision):
            perform(session.dismiss(revision: revision))
        case .shutdown:
            perform(session.shutdown())
        }
    }

    private func perform(_ effects: [SessionEffect]) {
        for effect in effects {
            switch effect {
            case .stopHoverTimers:
                stopHoverTimers()
            case .cancelExit:
                exitWorkItem?.cancel()
                exitWorkItem = nil
            case let .show(revision, payload):
                show(revision: revision, payload: payload)
            case let .animateExit(revision, durationMilliseconds):
                animateExit(revision: revision, durationMilliseconds: durationMilliseconds)
            case let .hideAndAcknowledge(revision):
                hideAndAcknowledge(revision: revision)
            case .hide:
                exitWorkItem?.cancel()
                exitWorkItem = nil
                withAnimation(nil) {
                    viewModel.setMotionTarget(.hidden)
                    viewModel.hide()
                }
                panel.orderOut(nil)
            case .terminate:
                terminate()
            }
        }
    }

    private func show(revision: Int64, payload: PresentationPayload) {
        guard let placement = placement(for: payload) else {
            writeDiagnostic("screen-error kind=no-screen displayId=\(payload.displayId)")
            return
        }

        let wasVisible = panel.isVisible
        panel.setFrame(placement.bounds.cgRect, display: false)
        let entrance = MotionPlan.entrance(reducedMotion: payload.reducedMotion)

        if !wasVisible {
            viewModel.setMotionTarget(entrance.from)
            viewModel.apply(revision: revision, payload: payload, placement: placement)
            panel.orderFrontRegardless()
        } else {
            withAnimation(payload.reducedMotion ? nil : .easeInOut(duration: 0.14)) {
                viewModel.apply(revision: revision, payload: payload, placement: placement)
            }
        }

        withAnimation(animation(for: entrance.transition)) {
            viewModel.setMotionTarget(entrance.to)
        }
    }

    private func animateExit(revision: Int64, durationMilliseconds: Int) {
        let exit = MotionPlan.exit(reducedMotion: false)
        withAnimation(animation(for: exit.transition)) {
            viewModel.setMotionTarget(exit.to)
        }

        let workItem = DispatchWorkItem { [weak self] in
            Task { @MainActor [weak self] in
                self?.finishExit(revision: revision)
            }
        }
        exitWorkItem = workItem
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(durationMilliseconds),
            execute: workItem
        )
    }

    private func finishExit(revision: Int64) {
        exitWorkItem = nil
        perform(session.exitAnimationCompleted(revision: revision))
    }

    private func hideAndAcknowledge(revision: Int64) {
        exitWorkItem?.cancel()
        exitWorkItem = nil
        withAnimation(nil) {
            viewModel.setMotionTarget(.hidden)
            viewModel.hide()
        }
        panel.orderOut(nil)
        send(.hidden(revision: revision))
    }

    private func handleHover(revision: Int64, hovering: Bool) {
        guard revision == session.revision else {
            return
        }
        performHover(session.reduceHover(hovering ? .pointerEntered : .pointerExited))
    }

    private func performHover(_ effects: [HoverEffect]) {
        for effect in effects {
            switch effect {
            case let .scheduleExpand(milliseconds):
                expandWorkItem?.cancel()
                let workItem = DispatchWorkItem { [weak self] in
                    Task { @MainActor [weak self] in
                        self?.hoverDelayElapsed(.expandDelayElapsed)
                    }
                }
                expandWorkItem = workItem
                DispatchQueue.main.asyncAfter(
                    deadline: .now() + .milliseconds(milliseconds),
                    execute: workItem
                )
            case let .scheduleCollapse(milliseconds):
                collapseWorkItem?.cancel()
                let workItem = DispatchWorkItem { [weak self] in
                    Task { @MainActor [weak self] in
                        self?.hoverDelayElapsed(.collapseDelayElapsed)
                    }
                }
                collapseWorkItem = workItem
                DispatchQueue.main.asyncAfter(
                    deadline: .now() + .milliseconds(milliseconds),
                    execute: workItem
                )
            case .cancelExpand:
                expandWorkItem?.cancel()
                expandWorkItem = nil
            case .cancelCollapse:
                collapseWorkItem?.cancel()
                collapseWorkItem = nil
            case let .emitExpanded(expanded):
                guard let revision = session.revision else {
                    continue
                }
                send(.setExpanded(revision: revision, expanded: expanded))
            }
        }
    }

    private func hoverDelayElapsed(_ input: HoverInput) {
        switch input {
        case .expandDelayElapsed:
            expandWorkItem = nil
        case .collapseDelayElapsed:
            collapseWorkItem = nil
        default:
            break
        }
        performHover(session.reduceHover(input))
    }

    private func stopHoverTimers() {
        expandWorkItem?.cancel()
        collapseWorkItem?.cancel()
        expandWorkItem = nil
        collapseWorkItem = nil
    }

    private func openActivity(revision: Int64, activityId: String) {
        guard
            revision == session.revision,
            session.isVisible,
            !session.isAnimating,
            let payload = session.payload,
            payload.activities.contains(where: { $0.activityId == activityId })
        else {
            return
        }

        if payload.expanded {
            performHover(session.waitForFreshCompactEntry())
        }
        send(.openActivity(revision: revision, activityId: activityId))
    }

    private func observeScreenChanges() {
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.repositionVisibleSnapshot()
            }
        }
    }

    private func removeScreenObserver() {
        if let screenObserver {
            NotificationCenter.default.removeObserver(screenObserver)
            self.screenObserver = nil
        }
    }

    private func repositionVisibleSnapshot() {
        guard session.isVisible, let payload = session.payload, let placement = placement(for: payload) else {
            return
        }
        panel.setFrame(placement.bounds.cgRect, display: false)
        viewModel.reposition(placement)
    }

    private func placement(for payload: PresentationPayload) -> IslandPlacement? {
        guard let screen = screen(displayId: payload.displayId) else {
            return nil
        }
        let size = payload.expanded
            ? IslandGeometry.expandedSize(activityCount: payload.activities.count)
            : IslandGeometry.compactSize
        return IslandGeometry.placement(on: ScreenGeometry(screen), size: size)
    }

    private func screen(displayId: Int64) -> NSScreen? {
        if let matching = NSScreen.screens.first(where: { screen in
            let key = NSDeviceDescriptionKey("NSScreenNumber")
            return (screen.deviceDescription[key] as? NSNumber)?.int64Value == displayId
        }) {
            return matching
        }

        if warnedDisplayIds.insert(displayId).inserted {
            writeDiagnostic("screen-warning kind=missing-display displayId=\(displayId)")
        }
        return NSScreen.main ?? NSScreen.screens.first
    }

    private func animation(for transition: MotionTransition) -> Animation? {
        switch transition {
        case let .spring(stiffness, damping, mass):
            .interpolatingSpring(
                mass: mass,
                stiffness: stiffness,
                damping: damping,
                initialVelocity: 0
            )
        case let .cubic(durationMilliseconds, controlPoints):
            .timingCurve(
                controlPoints.x1,
                controlPoints.y1,
                controlPoints.x2,
                controlPoints.y2,
                duration: Double(durationMilliseconds) / 1_000
            )
        case .immediate:
            nil
        }
    }

    private func send(_ event: HelperEvent) {
        do {
            try FileHandle.standardOutput.write(contentsOf: event.encodedLine())
        } catch {
            writeDiagnostic("output-error kind=write-failed")
        }
    }

    private func writeDiagnostic(_ metadata: String) {
        FileHandle.standardError.write(Data((metadata + "\n").utf8))
    }

    private func terminate() {
        guard !isTerminating else {
            return
        }
        isTerminating = true
        inputReader?.stop()
        inputReader = nil
        removeScreenObserver()
        NSApp.terminate(nil)
    }
}

private extension IslandRect {
    var cgRect: CGRect {
        CGRect(x: x, y: y, width: width, height: height)
    }
}

private extension ScreenGeometry {
    init(_ screen: NSScreen) {
        let insets = screen.safeAreaInsets
        self.init(
            frame: IslandRect(screen.frame),
            safeAreaInsets: IslandInsets(
                top: insets.top,
                left: insets.left,
                bottom: insets.bottom,
                right: insets.right
            ),
            auxiliaryTopLeftArea: screen.auxiliaryTopLeftArea.map(IslandRect.init) ?? .zero,
            auxiliaryTopRightArea: screen.auxiliaryTopRightArea.map(IslandRect.init) ?? .zero
        )
    }
}

private extension IslandRect {
    init(_ rect: CGRect) {
        self.init(x: rect.origin.x, y: rect.origin.y, width: rect.width, height: rect.height)
    }
}
