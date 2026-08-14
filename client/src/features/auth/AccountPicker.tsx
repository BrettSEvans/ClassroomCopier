/**
 * The forced mock account picker (F10, Acceptance Scenario 1).
 *
 * It renders unconditionally on every sign-in — `prompt=select_account`
 * semantics. It never consults an existing session, because a remembered
 * choice is exactly the multi-account collision the picker exists to prevent.
 */
import { useEffect, useState } from 'react'
import type { AccountSummary } from '@classroom-copier/shared'
import { Button } from '../../components/shared'
import { listMockAccounts } from '../../lib/api-client'

interface AccountPickerProps {
  onChoose: (account: AccountSummary) => void
  onCancel: () => void
  busy?: boolean
}

export function AccountPicker({ onChoose, onCancel, busy = false }: AccountPickerProps) {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    listMockAccounts()
      .then((res) => {
        if (live) setAccounts(res.accounts)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="screen">
      <h2 className="screen-title">Choose an account</h2>
      <p className="screen-sub">
        Classroom Copier keeps courses separated by account — pick the one whose classes you want to
        copy.
      </p>
      <div className="account-list">
        {failed ? <p className="field-error">The account list could not be loaded.</p> : null}
        {(accounts ?? []).map((account) => (
          <button
            key={account.id}
            type="button"
            className="account-row"
            disabled={busy}
            onClick={() => onChoose(account)}
          >
            <span className="radio" aria-hidden="true" />
            <span className="account-avatar" aria-hidden="true">
              {account.initials}
            </span>
            <span>
              <span className="account-name">{account.displayName}</span>
              <br />
              <span className="account-email">{account.email}</span>
            </span>
          </button>
        ))}
        <div className="account-actions">
          <Button variant="link" disabled title="not available in mock mode">
            Use another account
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
