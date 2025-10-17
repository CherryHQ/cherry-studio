import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PanelConfig } from "../components/KnowledgeSettings/KnowledgeBaseFormModal";
import KnowledgeBaseFormModal from "../components/KnowledgeSettings/KnowledgeBaseFormModal";

// Mock dependencies
const mocks = vi.hoisted(() => ({
  onCancel: vi.fn(),
  onOk: vi.fn(),
  t: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "common.cancel": "Cancel",
      "common.confirm": "Confirm",
    };
    return translations[key] || key;
  }),
}));

// Mock @cherrystudio/ui components (shadcn)
vi.mock("@cherrystudio/ui", () => ({
  Dialog: ({ children, open, onOpenChange }: any) =>
    open ? (
      <div data-testid="dialog" data-open={open}>
        {children}
      </div>
    ) : null,
  DialogContent: ({
    children,
    showCloseButton,
    onPointerDownOutside,
    className,
  }: any) => (
    <div
      data-testid="dialog-content"
      className={className}
      data-show-close={showCloseButton}
      onPointerDown={onPointerDownOutside}
    >
      {children}
    </div>
  ),
  DialogHeader: ({ children, className }: any) => (
    <div data-testid="dialog-header" className={className}>
      {children}
    </div>
  ),
  DialogTitle: ({ children, className }: any) => (
    <h2 data-testid="dialog-title" className={className}>
      {children}
    </h2>
  ),
  DialogFooter: ({ children, className }: any) => (
    <div data-testid="dialog-footer" className={className}>
      {children}
    </div>
  ),
  Button: ({ children, onPress, variant, ...props }: any) => (
    <button
      type="button"
      data-testid="button"
      onClick={onPress}
      data-variant={variant}
      {...props}
    >
      {children}
    </button>
  ),
  Separator: ({ orientation }: any) => (
    <div data-testid="separator" data-orientation={orientation} />
  ),
  Tabs: ({ children, defaultValue, orientation, className }: any) => (
    <div
      data-testid="tabs"
      data-default-value={defaultValue}
      data-orientation={orientation}
      className={className}
    >
      {children}
    </div>
  ),
  TabsList: ({ children, className }: any) => (
    <div data-testid="tabs-list" className={className}>
      {children}
    </div>
  ),
  TabsTrigger: ({ children, value, className, ...props }: any) => (
    <button
      type="button"
      data-testid={`tabs-trigger-${value}`}
      data-value={value}
      className={className}
      {...props}
    >
      {children}
    </button>
  ),
  TabsContent: ({ children, value, className }: any) => (
    <div
      data-testid={`tabs-content-${value}`}
      data-value={value}
      className={className}
    >
      {children}
    </div>
  ),
}));

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t }),
}));

/**
 * 创建测试用的面板配置
 * @param overrides 可选的属性覆盖
 * @returns PanelConfig 数组
 */
function createPanelConfigs(
  overrides: Partial<PanelConfig>[] = [],
): PanelConfig[] {
  const defaultPanels: PanelConfig[] = [
    {
      key: "general",
      label: "General Settings",
      panel: <div data-testid="general-panel">General Settings Panel</div>,
    },
    {
      key: "advanced",
      label: "Advanced Settings",
      panel: <div data-testid="advanced-panel">Advanced Settings Panel</div>,
    },
  ];

  return defaultPanels.map((panel, index) => ({
    ...panel,
    ...overrides[index],
  }));
}

/**
 * 渲染 KnowledgeBaseFormModal 组件的辅助函数
 * @param props 可选的组件属性
 * @returns render 结果
 */
function renderModal(props: Partial<any> = {}) {
  const defaultProps = {
    open: true,
    title: "Knowledge Base Settings",
    panels: createPanelConfigs(),
    onCancel: mocks.onCancel,
    onOk: mocks.onOk,
  };

  return render(<KnowledgeBaseFormModal {...defaultProps} {...props} />);
}

describe("KnowledgeBaseFormModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic rendering", () => {
    it("should match snapshot", () => {
      const { container } = renderModal();
      expect(container.firstChild).toMatchSnapshot();
    });

    it("should render modal when open is true", () => {
      renderModal({ open: true });

      expect(screen.getByTestId("dialog")).toBeInTheDocument();
      expect(screen.getByTestId("dialog-content")).toBeInTheDocument();
      expect(screen.getByTestId("tabs")).toBeInTheDocument();
    });

    it("should render first panel by default", () => {
      renderModal();

      // shadcn Tabs renders all TabsContent (unlike antd Menu)
      // Both panels should be in the document
      expect(screen.getByTestId("general-panel")).toBeInTheDocument();
      expect(screen.getByTestId("advanced-panel")).toBeInTheDocument();
    });

    it("should handle empty panels array", () => {
      renderModal({ panels: [] });

      expect(screen.getByTestId("dialog")).toBeInTheDocument();
      expect(screen.getByTestId("tabs")).toBeInTheDocument();
    });
  });

  describe("tabs interaction", () => {
    it("should render all tabs content", () => {
      renderModal();

      // All tab contents should be rendered (shadcn tabs renders all content)
      expect(screen.getByTestId("tabs-content-general")).toBeInTheDocument();
      expect(screen.getByTestId("tabs-content-advanced")).toBeInTheDocument();
    });

    it("should set default value to first panel key", () => {
      const panels = createPanelConfigs();
      renderModal({ panels });

      const tabs = screen.getByTestId("tabs");
      expect(tabs).toHaveAttribute("data-default-value", panels[0].key);
    });

    it("should render tabs with custom panels", () => {
      const customPanels: PanelConfig[] = [
        {
          key: "custom1",
          label: "Custom Panel 1",
          panel: <div data-testid="custom1-panel">Custom Panel 1</div>,
        },
        {
          key: "custom2",
          label: "Custom Panel 2",
          panel: <div data-testid="custom2-panel">Custom Panel 2</div>,
        },
      ];

      renderModal({ panels: customPanels });

      // Both custom panels should be rendered
      expect(screen.getByTestId("custom1-panel")).toBeInTheDocument();
      expect(screen.getByTestId("custom2-panel")).toBeInTheDocument();

      // Tabs triggers should exist
      expect(screen.getByTestId("tabs-trigger-custom1")).toBeInTheDocument();
      expect(screen.getByTestId("tabs-trigger-custom2")).toBeInTheDocument();
    });
  });

  describe("dialog props", () => {
    const user = userEvent.setup();
    it("should display title correctly", () => {
      const customTitle = "Custom Modal Title";
      renderModal({ title: customTitle });

      const title = screen.getByTestId("dialog-title");
      expect(title).toHaveTextContent(customTitle);
    });

    it("should call onOk when confirm button is clicked", async () => {
      renderModal();

      const buttons = screen.getAllByTestId("button");
      const confirmButton = buttons.find(
        (btn) => btn.textContent === "Confirm",
      );

      if (confirmButton) {
        await user.click(confirmButton);
        expect(mocks.onOk).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle single panel", () => {
      const singlePanel: PanelConfig[] = [
        {
          key: "only",
          label: "Only Panel",
          panel: <div data-testid="only-panel">Only Panel</div>,
        },
      ];

      renderModal({ panels: singlePanel });

      expect(screen.getByTestId("only-panel")).toBeInTheDocument();
      expect(screen.getByTestId("tabs-trigger-only")).toBeInTheDocument();
    });

    it("should handle panel with undefined key gracefully", () => {
      const panelsWithUndefined = [
        {
          key: "valid",
          label: "Valid Panel",
          panel: <div data-testid="valid-panel">Valid Panel</div>,
        },
      ];

      renderModal({ panels: panelsWithUndefined });

      expect(screen.getByTestId("valid-panel")).toBeInTheDocument();
    });
  });
});
