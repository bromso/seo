import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Copy,
  Scissors,
  ClipboardPaste,
  Trash2,
  Share2,
  Pencil,
  Undo2,
  Redo2,
} from "lucide-react"
import { RadialMenu } from "@repo/ui/components/animate-ui/components/community/radial-menu"

const defaultMenuItems = [
  { id: 1, label: "Copy", icon: Copy },
  { id: 2, label: "Cut", icon: Scissors },
  { id: 3, label: "Paste", icon: ClipboardPaste },
  { id: 4, label: "Delete", icon: Trash2 },
  { id: 5, label: "Share", icon: Share2 },
  { id: 6, label: "Edit", icon: Pencil },
]

const meta = {
  title: "Animate UI/Community/RadialMenu",
  component: RadialMenu,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: { type: "number", min: 160, max: 400, step: 20 },
    },
    iconSize: {
      control: { type: "number", min: 12, max: 32, step: 2 },
    },
    bandWidth: {
      control: { type: "number", min: 20, max: 100, step: 5 },
    },
    innerGap: {
      control: { type: "number", min: 0, max: 20, step: 2 },
    },
    outerGap: {
      control: { type: "number", min: 0, max: 20, step: 2 },
    },
    outerRingWidth: {
      control: { type: "number", min: 4, max: 30, step: 2 },
    },
  },
  args: {
    menuItems: defaultMenuItems,
    size: 240,
    iconSize: 18,
    bandWidth: 50,
    innerGap: 8,
    outerGap: 8,
    outerRingWidth: 12,
  },
} satisfies Meta<typeof RadialMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <RadialMenu {...args}>
      <div className="flex size-80 items-center justify-center rounded-lg border-2 border-dashed">
        Right-click here
      </div>
    </RadialMenu>
  ),
}

export const ThreeItems: Story = {
  render: (args) => (
    <RadialMenu {...args}>
      <div className="flex size-80 items-center justify-center rounded-lg border-2 border-dashed">
        Right-click here (3 items)
      </div>
    </RadialMenu>
  ),
  args: {
    menuItems: [
      { id: 1, label: "Undo", icon: Undo2 },
      { id: 2, label: "Redo", icon: Redo2 },
      { id: 3, label: "Delete", icon: Trash2 },
    ],
  },
}

export const LargeMenu: Story = {
  render: (args) => (
    <RadialMenu {...args}>
      <div className="flex size-80 items-center justify-center rounded-lg border-2 border-dashed">
        Right-click for large menu
      </div>
    </RadialMenu>
  ),
  args: {
    size: 320,
    iconSize: 24,
    bandWidth: 70,
  },
}

export const SmallMenu: Story = {
  render: (args) => (
    <RadialMenu {...args}>
      <div className="flex size-60 items-center justify-center rounded-lg border-2 border-dashed">
        Right-click for small menu
      </div>
    </RadialMenu>
  ),
  args: {
    size: 180,
    iconSize: 14,
    bandWidth: 35,
  },
}

export const SingleItem: Story = {
  render: (args) => (
    <RadialMenu {...args}>
      <div className="flex size-80 items-center justify-center rounded-lg border-2 border-dashed">
        Right-click (single item)
      </div>
    </RadialMenu>
  ),
  args: {
    menuItems: [{ id: 1, label: "Delete", icon: Trash2 }],
  },
}

export const WithCustomTrigger: Story = {
  render: (args) => (
    <RadialMenu {...args}>
      <div className="rounded-lg bg-primary px-6 py-4 text-primary-foreground">
        Right-click this card
      </div>
    </RadialMenu>
  ),
}

export const NoChildren: Story = {
  render: (args) => <RadialMenu {...args} />,
}
