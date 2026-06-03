import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Menu,
  MenuTrigger,
  MenuPanel,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuSubmenuPanel,
} from "@repo/ui/components/animate-ui/components/base/menu"
import { Button } from "@repo/ui/components/button"
import React from "react"

const meta = {
  title: "Animate UI/Base/Menu",
  component: Menu,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Menu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Menu>
      <MenuTrigger render={<Button variant="outline" />}>Open Menu</MenuTrigger>
      <MenuPanel>
        <MenuGroup>
          <MenuGroupLabel>My Account</MenuGroupLabel>
          <MenuItem>
            Profile
            <MenuShortcut>Ctrl+P</MenuShortcut>
          </MenuItem>
          <MenuItem>
            Settings
            <MenuShortcut>Ctrl+S</MenuShortcut>
          </MenuItem>
          <MenuItem>Billing</MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem>Log out</MenuItem>
      </MenuPanel>
    </Menu>
  ),
}

export const WithCheckboxItems: Story = {
  render: function WithCheckboxItems() {
    const [showStatusBar, setShowStatusBar] = React.useState(true)
    const [showPanel, setShowPanel] = React.useState(false)

    return (
      <Menu>
        <MenuTrigger render={<Button variant="outline" />}>View Options</MenuTrigger>
        <MenuPanel>
          <MenuCheckboxItem checked={showStatusBar} onCheckedChange={setShowStatusBar}>
            Status Bar
          </MenuCheckboxItem>
          <MenuCheckboxItem checked={showPanel} onCheckedChange={setShowPanel}>
            Activity Panel
          </MenuCheckboxItem>
        </MenuPanel>
      </Menu>
    )
  },
}

export const WithRadioItems: Story = {
  render: function WithRadioItems() {
    const [theme, setTheme] = React.useState("system")

    return (
      <Menu>
        <MenuTrigger render={<Button variant="outline" />}>Theme</MenuTrigger>
        <MenuPanel>
          <MenuRadioGroup value={theme} onValueChange={setTheme}>
            <MenuGroupLabel>Appearance</MenuGroupLabel>
            <MenuRadioItem value="light">Light</MenuRadioItem>
            <MenuRadioItem value="dark">Dark</MenuRadioItem>
            <MenuRadioItem value="system">System</MenuRadioItem>
          </MenuRadioGroup>
        </MenuPanel>
      </Menu>
    )
  },
}

export const WithSubmenu: Story = {
  render: () => (
    <Menu>
      <MenuTrigger render={<Button variant="outline" />}>Actions</MenuTrigger>
      <MenuPanel>
        <MenuItem>New File</MenuItem>
        <MenuItem>Open File</MenuItem>
        <MenuSeparator />
        <MenuSubmenu>
          <MenuSubmenuTrigger>Share</MenuSubmenuTrigger>
          <MenuSubmenuPanel>
            <MenuItem>Email</MenuItem>
            <MenuItem>Link</MenuItem>
            <MenuItem>Slack</MenuItem>
          </MenuSubmenuPanel>
        </MenuSubmenu>
        <MenuSeparator />
        <MenuItem variant="destructive">Delete</MenuItem>
      </MenuPanel>
    </Menu>
  ),
}

export const DestructiveItem: Story = {
  render: () => (
    <Menu>
      <MenuTrigger render={<Button variant="outline" />}>More</MenuTrigger>
      <MenuPanel>
        <MenuItem>Edit</MenuItem>
        <MenuItem>Duplicate</MenuItem>
        <MenuSeparator />
        <MenuItem variant="destructive">Delete</MenuItem>
      </MenuPanel>
    </Menu>
  ),
}
