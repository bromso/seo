import Noise from "@repo/ui/components/Noise"
import type { Meta, StoryObj } from "@storybook/react-vite"

const meta = {
  title: "React Bits/Animations/Noise",
  component: Noise,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    patternSize: {
      control: { type: "range", min: 50, max: 500, step: 50 },
      description: "Size of the noise pattern texture",
    },
    patternScaleX: {
      control: { type: "range", min: 0.5, max: 5, step: 0.5 },
      description: "Horizontal scale of the noise pattern",
    },
    patternScaleY: {
      control: { type: "range", min: 0.5, max: 5, step: 0.5 },
      description: "Vertical scale of the noise pattern",
    },
    patternRefreshInterval: {
      control: { type: "range", min: 1, max: 10, step: 1 },
      description: "Frames between noise pattern refreshes (lower = faster)",
    },
    patternAlpha: {
      control: { type: "range", min: 5, max: 80, step: 5 },
      description: "Alpha transparency of the noise (0-255)",
    },
  },
  args: {
    patternSize: 250,
    patternScaleX: 1,
    patternScaleY: 1,
    patternRefreshInterval: 2,
    patternAlpha: 15,
  },
  decorators: [
    (Story) => (
      <div
        style={{
          width: 400,
          height: 300,
          position: "relative",
          overflow: "hidden",
          borderRadius: 12,
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          display: "grid",
          placeItems: "center",
          color: "white",
        }}
      >
        <p style={{ fontSize: 20, margin: 0, zIndex: 1 }}>Noise Overlay</p>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Noise>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const HeavyGrain: Story = {
  args: {
    patternAlpha: 50,
    patternRefreshInterval: 1,
    patternSize: 150,
  },
}
