import { useEffect, useMemo, useState } from 'react'

import { Badge, Button } from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingHelpText, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { literRoleAssignmentsApi } from '@renderer/ipc'
import { getSettingDomId } from '@renderer/pages/settings/settingsSearch/types'
import { literResolvedModelIdentityKey, type LiterServedAlias } from '@shared/types/literGateway'
import type {
  LiterRole,
  LiterRoleAssignments,
  LiterRoleDocumentSnapshot,
  LiterRoleSource
} from '@shared/types/literRoles'

import { IntegrationChoice } from './IntegrationFields'
import type { LiterGatewayAdministrationController } from './useLiterGatewayAdministration'

const roles: LiterRole[] = ['critic', 'judge', 'backup']
const UNASSIGNED = '__unassigned__'

function aliasKey(alias: LiterServedAlias): string {
  return JSON.stringify([alias.identity.gatewayConnectionId, alias.identity.alias])
}

export function LiterRoleAssignmentsPanel({
  controller,
  tr
}: {
  controller: LiterGatewayAdministrationController
  tr: (key: string, options?: Record<string, unknown>) => string
}) {
  const [revision, setRevision] = useState(0)
  const [assignments, setAssignments] = useState<Partial<LiterRoleAssignments>>({})
  const [source, setSource] = useState<LiterRoleSource>({ ownership: 'managed' })
  const [document, setDocument] = useState<LiterRoleDocumentSnapshot>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const availableAliases = useMemo(
    () =>
      (controller.catalog?.aliases ?? []).filter(
        (alias): alias is LiterServedAlias & { target: NonNullable<LiterServedAlias['target']> } =>
          Boolean(alias.enabled && alias.target && alias.reconciliation === 'resolved')
      ),
    [controller.catalog?.aliases]
  )

  const readDocument = async (nextSource: LiterRoleSource) => {
    const next = await literRoleAssignmentsApi.readDocument(nextSource)
    setSource(nextSource)
    setDocument(next)
  }

  useEffect(() => {
    let disposed = false
    void Promise.all([literRoleAssignmentsApi.read(), literRoleAssignmentsApi.readDocument({ ownership: 'managed' })])
      .then(([snapshot, roleDocument]) => {
        if (disposed) return
        setRevision(snapshot.revision)
        setAssignments(snapshot.assignments ?? {})
        setDocument(roleDocument)
      })
      .catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      disposed = true
    }
  }, [])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const selectRole = (role: LiterRole, value: string) => {
    if (value === UNASSIGNED) {
      setAssignments((current) => {
        const next = { ...current }
        delete next[role]
        return next
      })
      return
    }
    const alias = availableAliases.find((item) => aliasKey(item) === value)
    if (!alias) return
    setAssignments((current) => ({
      ...current,
      [role]: { model: alias.target, servedAlias: alias.identity }
    }))
  }

  const complete = roles.every((role) => assignments[role])
  const criticKey = assignments.critic ? literResolvedModelIdentityKey(assignments.critic.model) : undefined
  const judgeKey = assignments.judge ? literResolvedModelIdentityKey(assignments.judge.model) : undefined
  const backupKey = assignments.backup ? literResolvedModelIdentityKey(assignments.backup.model) : undefined
  const judgeCollides = Boolean(criticKey && judgeKey && criticKey === judgeKey)
  const backupDistinct = Boolean(backupKey && backupKey !== criticKey && backupKey !== judgeKey)

  return (
    <SettingGroup id={getSettingDomId('/settings/liter-llm', 'model-roles')} className="scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SettingTitle>{tr('roles.title')}</SettingTitle>
          <SettingDescription>{tr('roles.description')}</SettingDescription>
        </div>
        <Badge variant={complete ? 'secondary' : 'outline'}>
          {complete ? tr('roles.complete') : tr('roles.incomplete')}
        </Badge>
      </div>

      <div className="mt-4 grid gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          {roles.map((role) => {
            const assignment = assignments[role]
            const value = assignment
              ? JSON.stringify([assignment.servedAlias.gatewayConnectionId, assignment.servedAlias.alias])
              : UNASSIGNED
            return (
              <IntegrationChoice
                key={role}
                label={tr(`roles.${role}`)}
                value={value}
                onChange={(next) => selectRole(role, next)}
                disabled={busy || controller.busy}
                options={[
                  { value: UNASSIGNED, label: tr('roles.chooseModel') },
                  ...availableAliases.map((alias) => ({ value: aliasKey(alias), label: alias.displayName }))
                ]}
              />
            )
          })}
        </div>

        <SettingHelpText>{tr('roles.independenceHelp')}</SettingHelpText>
        {judgeCollides && (
          <p className={backupDistinct ? 'text-sm text-warning' : 'text-sm text-error'} role="status">
            {backupDistinct ? tr('roles.backupWillBeUsed') : tr('roles.backupMustDiffer')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!complete || busy || controller.busy}
            onClick={() =>
              void run(async () => {
                const next = await literRoleAssignmentsApi.save({
                  expectedRevision: revision,
                  assignments: assignments as LiterRoleAssignments
                })
                setRevision(next.revision)
                setAssignments(next.assignments ?? {})
                setMessage(tr('roles.saved'))
              })
            }>
            {tr('actions.saveRoles')}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run(async () => readDocument({ ownership: 'managed' }))}>
            {tr('actions.useManagedRoles')}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const selected = await literRoleAssignmentsApi.selectLocal()
                if (!('cancelled' in selected)) await readDocument(selected)
              })
            }>
            {tr('actions.chooseRoleFile')}
          </Button>
          {document?.assignments && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setAssignments(document.assignments ?? {})}>
              {tr('actions.loadRoleFile')}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!document || !complete || busy}
            onClick={() =>
              void run(async () => {
                const result = await literRoleAssignmentsApi.apply(source, document!.revision)
                if (result.state === 'applied') {
                  setDocument((current) => (current ? { ...current, revision: result.nextRevision } : current))
                }
                setMessage(tr(`roles.state.${result.state}`))
              })
            }>
            {tr('actions.applyRoles')}
          </Button>
          <Button
            variant="outline"
            disabled={!document || !complete || busy}
            onClick={() =>
              void run(async () => {
                const result = await literRoleAssignmentsApi.export(source, document!.revision)
                if (!result.cancelled) setMessage(tr(`roles.state.${result.state}`))
              })
            }>
            {tr('actions.exportRoles')}
          </Button>
        </div>

        {document && (
          <SettingHelpText className="break-all">
            {source.ownership === 'managed' ? tr('roles.managedFile') : tr('roles.localFile')}: {document.path}
          </SettingHelpText>
        )}
        {message && <p className="text-sm text-success" role="status">{message}</p>}
        {error && <p className="break-words text-sm text-error" role="alert">{error}</p>}
      </div>
    </SettingGroup>
  )
}
