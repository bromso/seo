import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  PreviewLinkCard,
  PreviewLinkCardTrigger,
  PreviewLinkCardPanel,
  PreviewLinkCardImage,
} from "@repo/ui/components/animate-ui/components/base/preview-link-card"

const meta = {
  title: "Animate UI/Base/Preview Link Card",
  component: PreviewLinkCard,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PreviewLinkCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <PreviewLinkCard>
      <PreviewLinkCardTrigger
        render={
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium underline underline-offset-4"
          />
        }
      >
        Hover to preview link
      </PreviewLinkCardTrigger>
      <PreviewLinkCardPanel>
        <PreviewLinkCardImage
          src="https://placehold.co/400x200/e2e8f0/64748b?text=Link+Preview"
          alt="Link preview"
          className="w-full h-32 object-cover"
        />
        <div className="p-3 space-y-1">
          <h4 className="text-sm font-semibold">GitHub</h4>
          <p className="text-xs text-muted-foreground">
            Where the world builds software. Millions of developers use GitHub to build, ship, and
            maintain their software.
          </p>
        </div>
      </PreviewLinkCardPanel>
    </PreviewLinkCard>
  ),
}

export const TextOnly: Story = {
  render: () => (
    <PreviewLinkCard>
      <PreviewLinkCardTrigger
        render={
          <a
            href="#"
            className="text-sm font-medium underline underline-offset-4"
          />
        }
      >
        Documentation link
      </PreviewLinkCardTrigger>
      <PreviewLinkCardPanel>
        <div className="p-3 space-y-1">
          <h4 className="text-sm font-semibold">API Documentation</h4>
          <p className="text-xs text-muted-foreground">
            Comprehensive reference for all available endpoints, parameters, and response formats.
          </p>
        </div>
      </PreviewLinkCardPanel>
    </PreviewLinkCard>
  ),
}
