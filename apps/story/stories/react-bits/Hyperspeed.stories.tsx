import { hyperspeedPresets } from "@repo/ui/components/HyperSpeedPresets"
import Hyperspeed from "@repo/ui/components/Hyperspeed"
import type { Meta, StoryObj } from "@storybook/react-vite"

const meta = {
  title: "React Bits/Backgrounds/Hyperspeed",
  component: Hyperspeed,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  argTypes: {
    effectOptions: {
      control: { type: "object" },
      description: "Effect configuration options including distortion, colors, speeds, and more",
    },
  },
  args: {
    effectOptions: hyperspeedPresets.one,
  },
  decorators: [
    (Story) => (
      <div style={{ width: "100vw", height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Hyperspeed>

export default meta
type Story = StoryObj<typeof meta>

export const PresetOne: Story = {
  args: {
    effectOptions: hyperspeedPresets.one,
  },
}

export const PresetTwo: Story = {
  args: {
    effectOptions: hyperspeedPresets.two,
  },
}

export const PresetThree: Story = {
  args: {
    effectOptions: hyperspeedPresets.three,
  },
}

export const PresetFour: Story = {
  args: {
    effectOptions: hyperspeedPresets.four,
  },
}

export const PresetFive: Story = {
  args: {
    effectOptions: hyperspeedPresets.five,
  },
}

export const PresetSix: Story = {
  args: {
    effectOptions: hyperspeedPresets.six,
  },
}
