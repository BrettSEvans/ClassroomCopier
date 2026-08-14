import { Button } from '../../components/shared'

export const TAGLINE =
  'Batch-copy your classwork into any existing course — without duplicating Drive files.'
export const MOCK_SUBNOTE = 'v1 uses simulated Google accounts for demo/testing.'

export function SignInLanding({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="signin-screen">
      <div className="wordmark">
        <span className="seal" aria-hidden="true" />
        Classroom Copier
      </div>
      <p className="signin-tag">{TAGLINE}</p>
      <Button onClick={onSignIn}>Sign in with Google (mock)</Button>
      <div className="mock-note">{MOCK_SUBNOTE}</div>
    </div>
  )
}
