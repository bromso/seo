import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from "@repo/ui/components/animate-ui/components/base/accordion"

const meta = {
  title: "Animate UI/Base/Accordion",
  component: Accordion,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Accordion>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Accordion className="w-[400px]">
      <AccordionItem value="item-1">
        <AccordionTrigger>Is it accessible?</AccordionTrigger>
        <AccordionPanel>
          Yes. It adheres to the WAI-ARIA design pattern for accordions.
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Is it styled?</AccordionTrigger>
        <AccordionPanel>
          Yes. It comes with default styles that match the other components aesthetic.
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Is it animated?</AccordionTrigger>
        <AccordionPanel>
          Yes. It uses smooth animations powered by motion for open and close transitions.
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
}

export const WithoutArrow: Story = {
  render: () => (
    <Accordion className="w-[400px]">
      <AccordionItem value="item-1">
        <AccordionTrigger showArrow={false}>No arrow indicator</AccordionTrigger>
        <AccordionPanel>
          This accordion trigger does not display the chevron arrow icon.
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger showArrow={false}>Another item without arrow</AccordionTrigger>
        <AccordionPanel>Content for the second item.</AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
}

export const SingleItem: Story = {
  render: () => (
    <Accordion className="w-[400px]">
      <AccordionItem value="single">
        <AccordionTrigger>Single accordion item</AccordionTrigger>
        <AccordionPanel>
          This accordion contains only a single collapsible item.
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
}
