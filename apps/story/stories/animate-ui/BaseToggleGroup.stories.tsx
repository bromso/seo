import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  ToggleGroup,
  Toggle,
} from "@repo/ui/components/animate-ui/components/base/toggle-group"
import { AlignLeftIcon, AlignCenterIcon, AlignRightIcon, BoldIcon, ItalicIcon, UnderlineIcon } from "lucide-react"

const meta = {
  title: "Animate UI/Base/Toggle Group",
  component: ToggleGroup,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ToggleGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <ToggleGroup defaultValue="center">
      <Toggle value="left" aria-label="Align left">
        <AlignLeftIcon className="size-4" />
      </Toggle>
      <Toggle value="center" aria-label="Align center">
        <AlignCenterIcon className="size-4" />
      </Toggle>
      <Toggle value="right" aria-label="Align right">
        <AlignRightIcon className="size-4" />
      </Toggle>
    </ToggleGroup>
  ),
}

export const OutlineVariant: Story = {
  render: () => (
    <ToggleGroup variant="outline" defaultValue="left">
      <Toggle value="left" aria-label="Align left">
        <AlignLeftIcon className="size-4" />
      </Toggle>
      <Toggle value="center" aria-label="Align center">
        <AlignCenterIcon className="size-4" />
      </Toggle>
      <Toggle value="right" aria-label="Align right">
        <AlignRightIcon className="size-4" />
      </Toggle>
    </ToggleGroup>
  ),
}

export const Multiple: Story = {
  render: () => (
    <ToggleGroup multiple defaultValue={["bold"]}>
      <Toggle value="bold" aria-label="Bold">
        <BoldIcon className="size-4" />
      </Toggle>
      <Toggle value="italic" aria-label="Italic">
        <ItalicIcon className="size-4" />
      </Toggle>
      <Toggle value="underline" aria-label="Underline">
        <UnderlineIcon className="size-4" />
      </Toggle>
    </ToggleGroup>
  ),
}

export const SmallSize: Story = {
  render: () => (
    <ToggleGroup size="sm" defaultValue="center">
      <Toggle value="left" aria-label="Align left">
        <AlignLeftIcon className="size-4" />
      </Toggle>
      <Toggle value="center" aria-label="Align center">
        <AlignCenterIcon className="size-4" />
      </Toggle>
      <Toggle value="right" aria-label="Align right">
        <AlignRightIcon className="size-4" />
      </Toggle>
    </ToggleGroup>
  ),
}

export const LargeSize: Story = {
  render: () => (
    <ToggleGroup size="lg" defaultValue="center">
      <Toggle value="left" aria-label="Align left">
        <AlignLeftIcon className="size-4" />
      </Toggle>
      <Toggle value="center" aria-label="Align center">
        <AlignCenterIcon className="size-4" />
      </Toggle>
      <Toggle value="right" aria-label="Align right">
        <AlignRightIcon className="size-4" />
      </Toggle>
    </ToggleGroup>
  ),
}
