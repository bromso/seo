import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Progress,
  ProgressTrack,
  ProgressLabel,
  ProgressValue,
} from "@repo/ui/components/animate-ui/components/base/progress"

const meta = {
  title: "Animate UI/Base/Progress",
  component: Progress,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Progress>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Progress value={60} className="w-[400px]">
      <ProgressTrack />
    </Progress>
  ),
}

export const WithLabel: Story = {
  render: () => (
    <Progress value={45} className="w-[400px]">
      <div className="flex items-center justify-between mb-2">
        <ProgressLabel>Uploading...</ProgressLabel>
        <ProgressValue />
      </div>
      <ProgressTrack />
    </Progress>
  ),
}

export const Empty: Story = {
  render: () => (
    <Progress value={0} className="w-[400px]">
      <div className="flex items-center justify-between mb-2">
        <ProgressLabel>Not started</ProgressLabel>
        <ProgressValue />
      </div>
      <ProgressTrack />
    </Progress>
  ),
}

export const Complete: Story = {
  render: () => (
    <Progress value={100} className="w-[400px]">
      <div className="flex items-center justify-between mb-2">
        <ProgressLabel>Complete</ProgressLabel>
        <ProgressValue />
      </div>
      <ProgressTrack />
    </Progress>
  ),
}

export const HalfWay: Story = {
  render: () => (
    <Progress value={50} className="w-[400px]">
      <ProgressTrack />
    </Progress>
  ),
}
