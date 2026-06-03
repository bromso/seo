import type { Meta, StoryObj } from "@storybook/react-vite"
import { Heart, Star, ThumbsUp, Bookmark, Bell } from "lucide-react"
import { IconButton } from "@repo/ui/components/animate-ui/components/buttons/icon"

const meta = {
  title: "Animate UI/Buttons/IconButton",
  component: IconButton,
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
      options: ["default", "xs", "sm", "lg"],
    },
    disabled: {
      control: "boolean",
    },
  },
  args: {
    variant: "default",
    size: "default",
    children: <Heart className="size-4" />,
  },
} satisfies Meta<typeof IconButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Star_: Story = {
  name: "Star",
  args: {
    children: <Star className="size-4" />,
    variant: "outline",
  },
}

export const ThumbsUp_: Story = {
  name: "ThumbsUp",
  args: {
    children: <ThumbsUp className="size-4" />,
    variant: "secondary",
  },
}

export const Bookmark_: Story = {
  name: "Bookmark",
  args: {
    children: <Bookmark className="size-4" />,
    variant: "ghost",
  },
}

export const Destructive: Story = {
  args: {
    children: <Heart className="size-4" />,
    variant: "destructive",
  },
}

export const ExtraSmall: Story = {
  args: {
    size: "xs",
    children: <Heart className="size-3.5" />,
  },
}

export const Small: Story = {
  args: {
    size: "sm",
    children: <Heart className="size-4" />,
  },
}

export const Large: Story = {
  args: {
    size: "lg",
    children: <Heart className="size-5" />,
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <IconButton variant="default"><Heart className="size-4" /></IconButton>
      <IconButton variant="accent"><Star className="size-4" /></IconButton>
      <IconButton variant="destructive"><Heart className="size-4" /></IconButton>
      <IconButton variant="outline"><Bell className="size-4" /></IconButton>
      <IconButton variant="secondary"><ThumbsUp className="size-4" /></IconButton>
      <IconButton variant="ghost"><Bookmark className="size-4" /></IconButton>
    </div>
  ),
}
