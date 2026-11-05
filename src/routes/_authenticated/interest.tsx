import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/interest')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authenticated/interest"!</div>
}
