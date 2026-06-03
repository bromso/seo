Create a new page in the dashboard app.

## Usage
`/new-page <route-group> <page-name>`

## Route Groups
- **auth**: Authentication pages (login, signup, etc.)
- **dashboard**: Protected dashboard routes
- **errors**: Error pages (401, 403, 404, 503)
- **quiz**: Quiz/onboarding flow

## Instructions

1. Parse the arguments to get route-group and page-name
2. Create the page directory at `apps/app/src/app/(<route-group>)/<page-name>/`
3. Create `page.tsx` with the following template:

```tsx
export default function PageNamePage() {
  return (
    <div>
      <h1>Page Name</h1>
    </div>
  )
}
```

4. If the route group is "dashboard", the page is automatically protected by middleware
5. Suggest adding navigation link to sidebar if applicable

## Example
`/new-page dashboard analytics` creates:
- `apps/app/src/app/(dashboard)/analytics/page.tsx`
