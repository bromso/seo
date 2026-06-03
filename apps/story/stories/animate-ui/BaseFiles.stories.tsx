import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Files,
  FolderItem,
  FolderTrigger,
  FolderPanel,
  FileItem,
} from "@repo/ui/components/animate-ui/components/base/files"

const meta = {
  title: "Animate UI/Base/Files",
  component: Files,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Files>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Files className="w-[300px] rounded-md border">
      <FolderItem value="src">
        <FolderTrigger>src</FolderTrigger>
        <FolderPanel>
          <FolderItem value="components">
            <FolderTrigger>components</FolderTrigger>
            <FolderPanel>
              <FileItem>Button.tsx</FileItem>
              <FileItem>Input.tsx</FileItem>
              <FileItem>Dialog.tsx</FileItem>
            </FolderPanel>
          </FolderItem>
          <FolderItem value="lib">
            <FolderTrigger>lib</FolderTrigger>
            <FolderPanel>
              <FileItem>utils.ts</FileItem>
            </FolderPanel>
          </FolderItem>
          <FileItem>App.tsx</FileItem>
          <FileItem>index.ts</FileItem>
        </FolderPanel>
      </FolderItem>
      <FileItem>package.json</FileItem>
      <FileItem>tsconfig.json</FileItem>
    </Files>
  ),
}

export const WithGitStatus: Story = {
  render: () => (
    <Files className="w-[300px] rounded-md border">
      <FolderItem value="src">
        <FolderTrigger gitStatus="modified">src</FolderTrigger>
        <FolderPanel>
          <FileItem gitStatus="modified">App.tsx</FileItem>
          <FileItem gitStatus="untracked">NewComponent.tsx</FileItem>
          <FileItem gitStatus="deleted">OldComponent.tsx</FileItem>
          <FileItem>index.ts</FileItem>
        </FolderPanel>
      </FolderItem>
      <FolderItem value="tests">
        <FolderTrigger gitStatus="untracked">tests</FolderTrigger>
        <FolderPanel>
          <FileItem gitStatus="untracked">App.test.tsx</FileItem>
        </FolderPanel>
      </FolderItem>
      <FileItem>package.json</FileItem>
    </Files>
  ),
}

export const FlatFileList: Story = {
  render: () => (
    <Files className="w-[300px] rounded-md border">
      <FileItem>README.md</FileItem>
      <FileItem>package.json</FileItem>
      <FileItem>tsconfig.json</FileItem>
      <FileItem>.gitignore</FileItem>
      <FileItem>bun.lock</FileItem>
    </Files>
  ),
}
