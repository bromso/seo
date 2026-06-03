import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowRight, Check, ShoppingCart } from "lucide-react"
import {
  FlipButton,
  FlipButtonFront,
  FlipButtonBack,
} from "@repo/ui/components/animate-ui/components/buttons/flip"

const meta = {
  title: "Animate UI/Buttons/FlipButton",
  component: FlipButton,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "accent", "destructive", "outline", "secondary", "ghost", "link"],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon", "icon-sm", "icon-lg"],
    },
    from: {
      control: "select",
      options: ["top", "bottom", "left", "right"],
    },
  },
  args: {
    variant: "default",
    size: "default",
    from: "top",
  },
} satisfies Meta<typeof FlipButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <FlipButton {...args}>
      <FlipButtonFront>Hover me</FlipButtonFront>
      <FlipButtonBack>Hello!</FlipButtonBack>
    </FlipButton>
  ),
}

export const FromBottom: Story = {
  render: (args) => (
    <FlipButton {...args}>
      <FlipButtonFront>From Bottom</FlipButtonFront>
      <FlipButtonBack>Flipped!</FlipButtonBack>
    </FlipButton>
  ),
  args: {
    from: "bottom",
  },
}

export const FromLeft: Story = {
  render: (args) => (
    <FlipButton {...args}>
      <FlipButtonFront>From Left</FlipButtonFront>
      <FlipButtonBack>Flipped!</FlipButtonBack>
    </FlipButton>
  ),
  args: {
    from: "left",
  },
}

export const FromRight: Story = {
  render: (args) => (
    <FlipButton {...args}>
      <FlipButtonFront>From Right</FlipButtonFront>
      <FlipButtonBack>Flipped!</FlipButtonBack>
    </FlipButton>
  ),
  args: {
    from: "right",
  },
}

export const WithIcons: Story = {
  render: (args) => (
    <FlipButton {...args}>
      <FlipButtonFront>
        <ShoppingCart className="mr-2 size-4" />
        Add to Cart
      </FlipButtonFront>
      <FlipButtonBack>
        <Check className="mr-2 size-4" />
        Added!
      </FlipButtonBack>
    </FlipButton>
  ),
}

export const Outline: Story = {
  render: (args) => (
    <FlipButton {...args}>
      <FlipButtonFront>Learn More</FlipButtonFront>
      <FlipButtonBack>
        <ArrowRight className="size-4" />
      </FlipButtonBack>
    </FlipButton>
  ),
  args: {
    variant: "outline",
  },
}

export const Destructive: Story = {
  render: (args) => (
    <FlipButton {...args}>
      <FlipButtonFront>Delete</FlipButtonFront>
      <FlipButtonBack>Confirm?</FlipButtonBack>
    </FlipButton>
  ),
  args: {
    variant: "destructive",
  },
}

export const AllDirections: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {(["top", "bottom", "left", "right"] as const).map((direction) => (
        <FlipButton key={direction} from={direction}>
          <FlipButtonFront>{direction}</FlipButtonFront>
          <FlipButtonBack>Flipped!</FlipButtonBack>
        </FlipButton>
      ))}
    </div>
  ),
}
