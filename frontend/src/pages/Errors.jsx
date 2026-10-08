import { Link } from 'react-router-dom'

function ErrorPage({ code, message }) {
  return (
    <div className="py-16 text-center">
      <div className="text-5xl font-bold text-brand">{code}</div>
      <p className="mt-2 text-slate-600">{message}</p>
      <Link to="/dashboard" className="mt-4 inline-block text-brand underline">Back to dashboard</Link>
    </div>
  )
}

export const Forbidden = () => <ErrorPage code="403" message="You don't have permission to view this page." />
export const NotFound = () => <ErrorPage code="404" message="Page not found." />
