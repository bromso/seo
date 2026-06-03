import type { Meta, StoryObj } from "@storybook/react-vite"
import { UserPresenceAvatar } from "@repo/ui/components/animate-ui/components/community/user-presence-avatar"

const meta = {
  title: "Animate UI/Community/UserPresenceAvatar",
  component: UserPresenceAvatar,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof UserPresenceAvatar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
