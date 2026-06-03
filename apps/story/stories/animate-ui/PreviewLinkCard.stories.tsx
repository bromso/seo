import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  PreviewLinkCard,
  PreviewLinkCardTrigger,
  PreviewLinkCardContent,
  PreviewLinkCardImage,
} from "@repo/ui/components/animate-ui/components/radix/preview-link-card"

const meta = {
  title: "Animate UI/Radix/PreviewLinkCard",
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
    <p className="text-sm">
      Check out{" "}
      <PreviewLinkCard>
        <PreviewLinkCardTrigger asChild>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-4"
          >
            GitHub
          </a>
        </PreviewLinkCardTrigger>
        <PreviewLinkCardContent>
          <PreviewLinkCardImage
            src="https://github.githubassets.com/images/modules/site/social-cards/github-social.png"
            alt="GitHub preview"
          />
        </PreviewLinkCardContent>
      </PreviewLinkCard>{" "}
      for more information.
    </p>
  ),
}

export const MultipleLinks: Story = {
  render: () => (
    <p className="text-sm leading-relaxed max-w-md">
      We use tools like{" "}
      <PreviewLinkCard>
        <PreviewLinkCardTrigger asChild>
          <a
            href="https://vercel.com"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-4"
          >
            Vercel
          </a>
        </PreviewLinkCardTrigger>
        <PreviewLinkCardContent>
          <PreviewLinkCardImage
            src="https://assets.vercel.com/image/upload/front/vercel/dps.png"
            alt="Vercel preview"
          />
        </PreviewLinkCardContent>
      </PreviewLinkCard>{" "}
      for deployments and{" "}
      <PreviewLinkCard>
        <PreviewLinkCardTrigger asChild>
          <a
            href="https://react.dev"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-4"
          >
            React
          </a>
        </PreviewLinkCardTrigger>
        <PreviewLinkCardContent>
          <PreviewLinkCardImage
            src="https://react.dev/images/og-home.png"
            alt="React preview"
          />
        </PreviewLinkCardContent>
      </PreviewLinkCard>{" "}
      for building user interfaces.
    </p>
  ),
}
