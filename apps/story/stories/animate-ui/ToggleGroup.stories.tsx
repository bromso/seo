import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@repo/ui/components/animate-ui/components/radix/toggle-group"
import {
  AlignLeftIcon,
  AlignCenterIcon,
  AlignRightIcon,
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
} from "lucide-react"

const meta = {
  title: "Animate UI/Radix/ToggleGroup",
  component: ToggleGroup,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ToggleGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = {
  render: () => (
    <ToggleGroup type="single" defaultValue="center">
      <ToggleGroupItem value="left" aria-label="Align left">
        <AlignLeftIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <AlignCenterIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <AlignRightIcon className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const Multiple: Story = {
  render: () => (
    <ToggleGroup type="multiple" defaultValue={["bold"]}>
      <ToggleGroupItem value="bold" aria-label="Toggle bold">
        <BoldIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Toggle italic">
        <ItalicIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="underline" aria-label="Toggle underline">
        <UnderlineIcon className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const OutlineVariant: Story = {
  render: () => (
    <ToggleGroup type="single" variant="outline" defaultValue="center">
      <ToggleGroupItem value="left" aria-label="Align left">
        <AlignLeftIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <AlignCenterIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <AlignRightIcon className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const SmallSize: Story = {
  render: () => (
    <ToggleGroup type="single" size="sm" defaultValue="left">
      <ToggleGroupItem value="left" aria-label="Align left">
        <AlignLeftIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <AlignCenterIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <AlignRightIcon className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const LargeSize: Story = {
  render: () => (
    <ToggleGroup type="single" size="lg" defaultValue="left">
      <ToggleGroupItem value="left" aria-label="Align left">
        <AlignLeftIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <AlignCenterIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <AlignRightIcon className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const Disabled: Story = {
  render: () => (
    <ToggleGroup type="single" disabled defaultValue="center">
      <ToggleGroupItem value="left" aria-label="Align left">
        <AlignLeftIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <AlignCenterIcon className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <AlignRightIcon className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
}
