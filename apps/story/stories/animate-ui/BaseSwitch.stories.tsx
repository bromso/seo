import type { Meta, StoryObj } from "@storybook/react-vite"
import { Switch } from "@repo/ui/components/animate-ui/components/base/switch"
import { MoonIcon, SunIcon } from "lucide-react"
import React from "react"

const meta = {
  title: "Animate UI/Base/Switch",
  component: Switch,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    disabled: {
      control: "boolean",
    },
    defaultChecked: {
      control: "boolean",
    },
  },
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {},
}

export const Checked: Story = {
  args: {
    defaultChecked: true,
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}

export const DisabledChecked: Story = {
  args: {
    disabled: true,
    defaultChecked: true,
  },
}

export const WithLabel: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Switch id="base-airplane" {...args} />
      <label htmlFor="base-airplane" className="text-sm font-medium">
        Airplane Mode
      </label>
    </div>
  ),
}

export const WithIcons: Story = {
  render: () => (
    <Switch
      startIcon={<SunIcon />}
      endIcon={<MoonIcon />}
    />
  ),
}
