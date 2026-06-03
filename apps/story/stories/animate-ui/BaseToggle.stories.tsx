import type { Meta, StoryObj } from "@storybook/react-vite"
import { Toggle } from "@repo/ui/components/animate-ui/components/base/toggle"
import { BoldIcon, ItalicIcon } from "lucide-react"

const meta = {
  title: "Animate UI/Base/Toggle",
  component: Toggle,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "outline"],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
    },
    disabled: {
      control: "boolean",
    },
  },
  args: {
    variant: "default",
    size: "default",
  },
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Toggle aria-label="Toggle bold" {...args}>
      <BoldIcon className="size-4" />
    </Toggle>
  ),
}

export const WithText: Story = {
  render: (args) => (
    <Toggle aria-label="Toggle italic" {...args}>
      <ItalicIcon className="size-4" />
      Italic
    </Toggle>
  ),
}

export const OutlineVariant: Story = {
  render: (args) => (
    <Toggle aria-label="Toggle bold" {...args} variant="outline">
      <BoldIcon className="size-4" />
    </Toggle>
  ),
}

export const Pressed: Story = {
  render: (args) => (
    <Toggle aria-label="Toggle bold" defaultPressed {...args}>
      <BoldIcon className="size-4" />
    </Toggle>
  ),
}

export const Disabled: Story = {
  render: (args) => (
    <Toggle aria-label="Toggle bold" disabled {...args}>
      <BoldIcon className="size-4" />
    </Toggle>
  ),
}

export const Small: Story = {
  render: (args) => (
    <Toggle aria-label="Toggle bold" size="sm" {...args}>
      <BoldIcon className="size-4" />
    </Toggle>
  ),
}

export const Large: Story = {
  render: (args) => (
    <Toggle aria-label="Toggle bold" size="lg" {...args}>
      <BoldIcon className="size-4" />
    </Toggle>
  ),
}
