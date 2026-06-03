import ElasticSlider from "@repo/ui/components/ElasticSlider"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Minus, Plus, Volume1, Volume2 } from "lucide-react"

const meta = {
  title: "React Bits/Components/ElasticSlider",
  component: ElasticSlider,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    defaultValue: {
      control: { type: "number", min: 0, max: 100 },
      description: "Initial value of the slider",
    },
    startingValue: {
      control: { type: "number", min: 0, max: 100 },
      description: "Minimum value of the slider range",
    },
    maxValue: {
      control: { type: "number", min: 1, max: 200 },
      description: "Maximum value of the slider range",
    },
    isStepped: {
      control: { type: "boolean" },
      description: "Snap to discrete steps",
    },
    stepSize: {
      control: { type: "number", min: 1, max: 25 },
      description: "Step increment when isStepped is true",
    },
  },
  args: {
    defaultValue: 50,
    startingValue: 0,
    maxValue: 100,
    isStepped: false,
    stepSize: 1,
  },
} satisfies Meta<typeof ElasticSlider>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    leftIcon: <Minus size={18} />,
    rightIcon: <Plus size={18} />,
  },
}

export const VolumeControl: Story = {
  args: {
    defaultValue: 30,
    startingValue: 0,
    maxValue: 100,
    leftIcon: <Volume1 size={18} />,
    rightIcon: <Volume2 size={18} />,
  },
}
