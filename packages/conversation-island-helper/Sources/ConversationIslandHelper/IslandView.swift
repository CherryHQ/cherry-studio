import AppKit
import Combine
import ConversationIslandCore
import SwiftUI

@MainActor
final class IslandViewModel: ObservableObject {
    @Published private(set) var revision: Int64?
    @Published private(set) var payload: PresentationPayload?
    @Published private(set) var placement: IslandPlacement?
    @Published private(set) var motionTarget = MotionTarget.visible
    @Published private(set) var isVisible = false

    func apply(revision: Int64, payload: PresentationPayload, placement: IslandPlacement) {
        self.revision = revision
        self.payload = payload
        self.placement = placement
        isVisible = true
    }

    func reposition(_ placement: IslandPlacement) {
        self.placement = placement
    }

    func setMotionTarget(_ target: MotionTarget) {
        motionTarget = target
    }

    func hide() {
        isVisible = false
    }
}

struct IslandView: View {
    @ObservedObject var viewModel: IslandViewModel
    let onHoverChanged: (Int64, Bool) -> Void
    let onOpenActivity: (Int64, String) -> Void

    var body: some View {
        Group {
            if let revision = viewModel.revision,
               let payload = viewModel.payload,
               let placement = viewModel.placement
            {
                surface(revision: revision, payload: payload, placement: placement)
                    .id(ContentIdentity(revision: revision, expanded: payload.expanded))
                    .transition(.opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
                    .onHover { hovering in
                        onHoverChanged(revision, hovering)
                    }
                    .preferredColorScheme(payload.theme.appearance == .dark ? .dark : .light)
            }
        }
        .opacity(viewModel.motionTarget.opacity)
        .scaleEffect(
            x: viewModel.motionTarget.scaleX,
            y: viewModel.motionTarget.scaleY,
            anchor: .top
        )
    }

    @ViewBuilder
    private func surface(
        revision: Int64,
        payload: PresentationPayload,
        placement: IslandPlacement
    ) -> some View {
        let model = SurfaceModel(payload: payload)
        let colors = SurfaceColors(theme: payload.theme, presentation: placement.presentation)

        VStack(spacing: 0) {
            switch model {
            case let .compact(primary, activityCountText):
                compactSurface(
                    revision: revision,
                    primary: primary,
                    activityCountText: activityCountText,
                    activityCount: payload.activities.count,
                    placement: placement,
                    theme: payload.theme,
                    colors: colors
                )
            case let .singleDetail(activity):
                expandedHeader(
                    activity: activity,
                    activityCountText: payload.activityCountText,
                    activityCount: 1,
                    theme: payload.theme,
                    colors: colors
                )
                Button {
                    onOpenActivity(revision, activity.activityId)
                } label: {
                    singleDetail(activity: activity, theme: payload.theme, colors: colors)
                }
                .buttonStyle(.plain)
            case let .activityList(activities, primaryActivityId):
                expandedHeader(
                    activity: activities.first { $0.activityId == primaryActivityId }!,
                    activityCountText: payload.activityCountText,
                    activityCount: activities.count,
                    theme: payload.theme,
                    colors: colors
                )
                ScrollView(.vertical, showsIndicators: activities.count > IslandGeometry.maximumVisibleExpandedRows) {
                    LazyVStack(spacing: 0) {
                        ForEach(activities, id: \.activityId) { activity in
                            Button {
                                onOpenActivity(revision, activity.activityId)
                            } label: {
                                activityRow(
                                    activity: activity,
                                    isPrimary: activity.activityId == primaryActivityId,
                                    theme: payload.theme,
                                    colors: colors
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .frame(width: placement.bounds.width, height: placement.bounds.height, alignment: .top)
        .foregroundStyle(colors.primaryText)
        .background {
            background(presentation: placement.presentation, expanded: payload.expanded, colors: colors)
        }
        .clipShape(surfaceShape(presentation: placement.presentation, expanded: payload.expanded))
        .overlay {
            surfaceShape(presentation: placement.presentation, expanded: payload.expanded)
                .stroke(colors.border, lineWidth: placement.presentation == .capsule ? 1 : 0)
        }
        .accentColor(primaryColor(payload.theme))
        .shadow(color: colors.shadow, radius: 14, y: 6)
    }

    private func compactSurface(
        revision: Int64,
        primary: PresentationActivity,
        activityCountText: String,
        activityCount: Int,
        placement: IslandPlacement,
        theme: PresentationTheme,
        colors: SurfaceColors
    ) -> some View {
        Button {
            onOpenActivity(revision, primary.activityId)
        } label: {
            if placement.presentation == .notch, let notchWidth = placement.notchWidth {
                let sideWidth = max(0, (placement.bounds.width - notchWidth) / 2)
                HStack(spacing: 0) {
                    compactStatus(primary, theme: theme, colors: colors)
                        .padding(.leading, 10)
                        .padding(.trailing, 4)
                        .frame(width: sideWidth, alignment: .leading)
                    Color.clear.frame(width: notchWidth)
                    compactTrailing(primary, activityCountText: activityCountText, activityCount: activityCount, theme: theme)
                        .padding(.leading, 4)
                        .padding(.trailing, 10)
                        .frame(width: sideWidth, alignment: .trailing)
                }
            } else {
                HStack(spacing: 10) {
                    compactStatus(primary, theme: theme, colors: colors)
                    Spacer(minLength: 8)
                    compactTrailing(primary, activityCountText: activityCountText, activityCount: activityCount, theme: theme)
                }
                .padding(.horizontal, 14)
            }
        }
        .buttonStyle(.plain)
        .frame(height: IslandGeometry.compactSize.height)
    }

    private func compactStatus(
        _ activity: PresentationActivity,
        theme: PresentationTheme,
        colors: SurfaceColors
    ) -> some View {
        HStack(spacing: 7) {
            StatusDot(
                color: statusColor(activity.state),
                isPulsing: viewModel.isVisible && activity.state.isPulsing
            )
            Text(activity.statusText)
                .font(resolvedFont(theme: theme, size: 12, weight: .medium))
                .foregroundStyle(colors.secondaryText)
                .lineLimit(1)
        }
    }

    private func compactTrailing(
        _ activity: PresentationActivity,
        activityCountText: String,
        activityCount: Int,
        theme: PresentationTheme
    ) -> some View {
        Text(activityCount > 1 ? activityCountText : activity.title)
            .font(resolvedFont(theme: theme, size: 12, weight: .semibold))
            .lineLimit(1)
            .truncationMode(.tail)
    }

    private func expandedHeader(
        activity: PresentationActivity,
        activityCountText: String,
        activityCount: Int,
        theme: PresentationTheme,
        colors: SurfaceColors
    ) -> some View {
        HStack(spacing: 8) {
            if activityCount == 1 {
                avatar(activity.identityAvatar, theme: theme, colors: colors)
                Text(activity.identityName)
                    .font(resolvedFont(theme: theme, size: 12, weight: .semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                compactStatus(activity, theme: theme, colors: colors)
            } else {
                Circle()
                    .fill(primaryColor(theme))
                    .frame(width: 7, height: 7)
                Text(activityCountText)
                    .font(resolvedFont(theme: theme, size: 12, weight: .semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: IslandGeometry.expandedHeaderHeight)
        .overlay(alignment: .bottom) {
            Rectangle().fill(colors.divider).frame(height: 1)
        }
    }

    private func singleDetail(
        activity: PresentationActivity,
        theme: PresentationTheme,
        colors: SurfaceColors
    ) -> some View {
        HStack(spacing: 10) {
            StatusDot(
                color: statusColor(activity.state),
                isPulsing: viewModel.isVisible && activity.state.isPulsing
            )
            Text(activity.title)
                .font(resolvedFont(theme: theme, size: 13, weight: .medium))
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(activity.statusText)
                .font(resolvedFont(theme: theme, size: 11, weight: .regular))
                .foregroundStyle(colors.secondaryText)
                .lineLimit(1)
        }
        .padding(.horizontal, 14)
        .frame(height: IslandGeometry.singleDetailHeight)
        .contentShape(Rectangle())
    }

    private func activityRow(
        activity: PresentationActivity,
        isPrimary: Bool,
        theme: PresentationTheme,
        colors: SurfaceColors
    ) -> some View {
        HStack(spacing: 10) {
            avatar(activity.identityAvatar, theme: theme, colors: colors)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if isPrimary {
                        Circle().fill(primaryColor(theme)).frame(width: 6, height: 6)
                    }
                    Text(activity.title)
                        .font(resolvedFont(theme: theme, size: 12, weight: .semibold))
                        .lineLimit(1)
                }
                HStack(spacing: 6) {
                    StatusDot(
                        color: statusColor(activity.state),
                        isPulsing: viewModel.isVisible && activity.state.isPulsing
                    )
                    Text(activity.statusText)
                        .font(resolvedFont(theme: theme, size: 11, weight: .regular))
                        .foregroundStyle(colors.secondaryText)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 14)
        .frame(height: IslandGeometry.activityListRowHeight)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            Rectangle().fill(colors.divider).frame(height: 1)
        }
    }

    private func avatar(
        _ value: String,
        theme: PresentationTheme,
        colors: SurfaceColors
    ) -> some View {
        Text(value)
            .font(resolvedFont(theme: theme, size: 15, weight: .regular))
            .frame(width: 26, height: 26)
            .background(colors.avatarBackground)
            .clipShape(Circle())
    }

    @ViewBuilder
    private func background(
        presentation: IslandPresentation,
        expanded: Bool,
        colors: SurfaceColors
    ) -> some View {
        if presentation == .notch {
            Color.black
        } else {
            colors.background
        }
    }

    private func surfaceShape(presentation: IslandPresentation, expanded: Bool) -> SurfaceShape {
        SurfaceShape(presentation: presentation, expanded: expanded)
    }

    private func statusColor(_ state: ActivityState) -> Color {
        switch state {
        case .pending:
            Color(nsColor: .secondaryLabelColor)
        case .streaming:
            Color(nsColor: .systemBlue)
        case .awaitingConfirmation:
            Color(nsColor: .systemOrange)
        case .done:
            Color(nsColor: .systemGreen)
        case .error:
            Color(nsColor: .systemRed)
        }
    }

    private func primaryColor(_ theme: PresentationTheme) -> Color {
        let color = HexColor(theme.primaryColor).rgba
        return Color(red: color.red, green: color.green, blue: color.blue, opacity: color.alpha)
    }

    private func resolvedFont(theme: PresentationTheme, size: CGFloat, weight: Font.Weight) -> Font {
        guard let family = parseFontFamily(theme.fontFamily), NSFont(name: family, size: size) != nil else {
            return .system(size: size, weight: weight)
        }
        return .custom(family, size: size).weight(weight)
    }
}

private struct ContentIdentity: Hashable {
    let revision: Int64
    let expanded: Bool
}

private struct SurfaceColors {
    let background: Color
    let primaryText: Color
    let secondaryText: Color
    let border: Color
    let divider: Color
    let shadow: Color
    let avatarBackground: Color

    init(theme: PresentationTheme, presentation: IslandPresentation) {
        if presentation == .notch {
            background = .black
            primaryText = .white
            secondaryText = Color.white.opacity(0.68)
            border = .clear
            divider = Color.white.opacity(0.12)
            shadow = Color.black.opacity(0.28)
            avatarBackground = Color.white.opacity(0.12)
        } else if theme.appearance == .dark {
            background = Color(red: 0.12, green: 0.12, blue: 0.13)
            primaryText = Color.white.opacity(0.94)
            secondaryText = Color.white.opacity(0.62)
            border = Color.white.opacity(0.14)
            divider = Color.white.opacity(0.1)
            shadow = Color.black.opacity(0.34)
            avatarBackground = Color.white.opacity(0.1)
        } else {
            background = Color(red: 0.98, green: 0.98, blue: 0.99)
            primaryText = Color.black.opacity(0.9)
            secondaryText = Color.black.opacity(0.56)
            border = Color.black.opacity(0.12)
            divider = Color.black.opacity(0.08)
            shadow = Color.black.opacity(0.2)
            avatarBackground = Color.black.opacity(0.06)
        }
    }
}

private struct StatusDot: View {
    let color: Color
    let isPulsing: Bool
    @State private var dimmed = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
            .opacity(dimmed ? 0.35 : 1)
            .onAppear(perform: updatePulse)
            .onChange(of: isPulsing) { _ in updatePulse() }
    }

    private func updatePulse() {
        if isPulsing {
            withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                dimmed = true
            }
        } else {
            withAnimation(nil) {
                dimmed = false
            }
        }
    }
}

private struct SurfaceShape: Shape {
    let presentation: IslandPresentation
    let expanded: Bool

    func path(in rect: CGRect) -> Path {
        if presentation == .capsule {
            return RoundedRectangle(cornerRadius: expanded ? 12 : 19, style: .continuous)
                .path(in: rect)
        }

        var path = Path()
        let radius = min(12, rect.width / 2, rect.height / 2)
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - radius, y: rect.maxY),
            control: CGPoint(x: rect.maxX, y: rect.maxY)
        )
        path.addLine(to: CGPoint(x: rect.minX + radius, y: rect.maxY))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX, y: rect.maxY - radius),
            control: CGPoint(x: rect.minX, y: rect.maxY)
        )
        path.closeSubpath()
        return path
    }
}

private extension ActivityState {
    var isPulsing: Bool {
        self == .pending || self == .streaming
    }
}
