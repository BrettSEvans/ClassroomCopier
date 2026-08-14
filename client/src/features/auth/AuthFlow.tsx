/**
 * Landing -> forced picker -> signed in.
 *
 * `startAt="picker"` is how the header's "Switch account" re-enters: straight
 * to the picker, which is still rendered unconditionally.
 */
import { useState } from 'react'
import type { AccountSummary } from '@classroom-copier/shared'
import { AccountPicker } from './AccountPicker'
import { SignInLanding } from './SignInLanding'
import { signIn } from '../../lib/api-client'

interface AuthFlowProps {
  onSignedIn: (account: AccountSummary) => void
  startAt?: 'landing' | 'picker'
  onError?: (error: unknown) => void
}

export function AuthFlow({ onSignedIn, startAt = 'landing', onError }: AuthFlowProps) {
  const [stage, setStage] = useState<'landing' | 'picker'>(startAt)
  const [busy, setBusy] = useState(false)

  if (stage === 'landing') {
    return <SignInLanding onSignIn={() => setStage('picker')} />
  }

  const choose = (account: AccountSummary) => {
    setBusy(true)
    signIn(account.id)
      .then((session) => onSignedIn(session.account))
      .catch((error: unknown) => onError?.(error))
      .finally(() => setBusy(false))
  }

  return <AccountPicker onChoose={choose} onCancel={() => setStage('landing')} busy={busy} />
}
