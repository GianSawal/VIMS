import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Car, Eye, KeyRound, MapPin, Pencil, Plus, Power, ShieldCheck, Users as UsersIcon } from 'lucide-react'
import { api, applyFieldErrors, errorMessage, useList } from '../../api'
import { useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import { Avatar, CardGrid, SearchBox, selectClass, StatCard, Toolbar } from '../../components/filters'
import { Badge, Button, ConfirmDialog, Field, formatDateTime, inputClass, Modal, PageHeader } from '../../components/ui'
import { useToast } from '../../components/toast'
import { useAllOffices } from './Offices'

export const ROLES = ['System Administrator', 'Fleet Administrator', 'Field Office User', 'Viewer']
const roleTone = { 'System Administrator': 'red', 'Fleet Administrator': 'blue', 'Field Office User': 'gold', Viewer: 'gray' }

const ROLE_CARDS = {
  ALL: [UsersIcon, 'bg-slate-100 text-slate-700', 'All users'],
  'System Administrator': [ShieldCheck, 'bg-red-50 text-danger', 'System admins'],
  'Fleet Administrator': [Car, 'bg-brand-light text-brand', 'Fleet admins'],
  'Field Office User': [MapPin, 'bg-amber-50 text-amber-700', 'Field office'],
  Viewer: [Eye, 'bg-slate-100 text-slate-600', 'Viewers'],
}
const roleCard = (r) => ({ icon: ROLE_CARDS[r][0], tint: ROLE_CARDS[r][1], label: ROLE_CARDS[r][2] })

export default function Users() {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [active, setActive] = useState('')
  const [editing, setEditing] = useState(null)
  const [resetting, setResetting] = useState(null)
  const [toggling, setToggling] = useState(null)
  const query = useList('/users/', { page, search, groups__name: role, is_active: active })
  const everyone = useList('/users/', { page_size: 500 }) // unfiltered, for the role cards (user lists are small)
  const count = (r) => everyone.data?.results.filter((u) => !r || u.role_name === r).length

  const toggle = useMutation({
    mutationFn: (u) => api.patch(`/users/${u.id}/`, { is_active: !u.is_active }),
    onSuccess: (_, u) => {
      qc.invalidateQueries({ queryKey: ['/users/'] })
      toast(`${u.username} ${u.is_active ? 'deactivated' : 'activated'}.`)
      setToggling(null)
    },
    onError: (err) => { toast(errorMessage(err), 'error'); setToggling(null) },
  })

  const filter = (setter) => (value) => { setter(value); setPage(1) }
  const chips = [
    search && ['search', `Search: “${search}”`],
    role && ['role', `Role: ${role}`],
    active && ['active', active === 'true' ? 'Active only' : 'Inactive only'],
  ].filter(Boolean)
  const clear = { search: () => setSearch(''), role: () => setRole(''), active: () => setActive('') }
  const clearAll = () => { setSearch(''); setRole(''); setActive(''); setPage(1) }

  const columns = [
    { key: 'user', label: 'User', render: (u) => {
      const name = `${u.first_name} ${u.last_name}`.trim()
      return (
        <div className="flex items-center gap-3">
          <Avatar name={name || u.username} />
          <div className="min-w-0">
            <div className="font-semibold">{name || u.username}</div>
            <div className="truncate text-xs text-slate-500">@{u.username}{u.email && ` · ${u.email}`}</div>
          </div>
        </div>
      )
    } },
    { key: 'role', label: 'Role', render: (u) => u.role_name ? <Badge tone={roleTone[u.role_name]}>{u.role_name}</Badge> : <span className="text-slate-400">No role</span> },
    { key: 'offices', label: 'Offices', render: (u) => {
      const codes = u.office_details.map((o) => o.code)
      if (!codes.length) return <span className="text-slate-400">—</span>
      return (
        <div className="flex flex-wrap gap-1" title={u.office_details.map((o) => o.name).join(', ')}>
          {codes.slice(0, 3).map((c) => <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{c}</span>)}
          {codes.length > 3 && <span className="px-1 text-xs text-slate-500">+{codes.length - 3}</span>}
        </div>
      )
    } },
    { key: 'status', label: 'Status', render: (u) => (
      <div className="flex flex-col items-start gap-1">
        <Badge tone={u.is_active ? 'green' : 'gray'} dot>{u.is_active ? 'Active' : 'Inactive'}</Badge>
        {u.must_change_password && <span className="text-xs text-amber-700">Password change pending</span>}
      </div>
    ) },
    { key: 'last_login', label: 'Last login', render: (u) => u.last_login ? formatDateTime(u.last_login) : <span className="text-slate-400">Never</span> },
    { key: 'actions', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (u) => (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" onClick={() => setEditing(u)} aria-label={`Edit ${u.username}`} title="Edit"><Pencil size={16} /></Button>
        <Button variant="ghost" onClick={() => setResetting(u)} aria-label={`Reset password for ${u.username}`} title="Reset password"><KeyRound size={16} /></Button>
        {u.id !== me?.id && (
          <Button variant="ghost" onClick={() => setToggling(u)} aria-label={`${u.is_active ? 'Deactivate' : 'Activate'} ${u.username}`}
            title={u.is_active ? 'Deactivate' : 'Activate'}><Power size={16} className={u.is_active ? 'text-danger' : 'text-green-700'} /></Button>
        )}
      </div>
    ) },
  ]

  const toolbar = (
    <Toolbar chips={chips} onRemove={(k) => { clear[k](); setPage(1) }} onClear={clearAll}>
      <SearchBox id="user-search" label="Search users" placeholder="Search name, username, email…" value={search} onChange={filter(setSearch)} />
      <select className={`${selectClass} w-48`} aria-label="Filter by role" value={role} onChange={(e) => filter(setRole)(e.target.value)}>
        <option value="">All roles</option>
        {ROLES.map((r) => <option key={r}>{r}</option>)}
      </select>
      <select className={`${selectClass} w-36`} aria-label="Filter by status" value={active} onChange={(e) => filter(setActive)(e.target.value)}>
        <option value="">All statuses</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </select>
    </Toolbar>
  )

  return (
    <div>
      <PageHeader title="Users" actions={<Button onClick={() => setEditing({})}><Plus size={16} /> Add user</Button>}>
        Accounts, roles and office access.
      </PageHeader>

      <CardGrid label="Filter by role">
        <StatCard {...roleCard('ALL')} count={count()} loading={everyone.isLoading} selected={!role} onClick={() => filter(setRole)('')} />
        {ROLES.map((r) => (
          <StatCard key={r} {...roleCard(r)} count={count(r)} loading={everyone.isLoading}
            selected={role === r} onClick={() => filter(setRole)(role === r ? '' : r)} />
        ))}
      </CardGrid>

      <DataTable columns={columns} query={query} page={page} onPage={setPage} toolbar={toolbar}
        empty={chips.length ? 'No users match these filters.' : 'No users yet.'} />

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.username}` : 'Add user'} wide>
        {editing && <UserForm key={editing.id ?? 'new'} user={editing} onClose={() => setEditing(null)} />}
      </Modal>
      <Modal open={!!resetting} onClose={() => setResetting(null)} title={`Reset password: ${resetting?.username}`}>
        {resetting && <ResetPasswordForm user={resetting} onClose={() => setResetting(null)} />}
      </Modal>
      <ConfirmDialog
        open={!!toggling}
        title={toggling?.is_active ? 'Deactivate user' : 'Activate user'}
        message={toggling?.is_active
          ? `${toggling?.username} will no longer be able to log in. Their history is kept.`
          : `${toggling?.username} will be able to log in again.`}
        confirmLabel={toggling?.is_active ? 'Deactivate' : 'Activate'}
        danger={toggling?.is_active}
        busy={toggle.isPending}
        onConfirm={() => toggle.mutate(toggling)}
        onClose={() => setToggling(null)}
      />
    </div>
  )
}

const baseSchema = {
  username: z.string().trim().min(1, 'Required').max(150),
  first_name: z.string().max(150),
  last_name: z.string().max(150),
  email: z.union([z.literal(''), z.email('Invalid email')]),
  role: z.string().min(1, 'Select a role'),
  offices: z.array(z.string()),
}
const createSchema = z.object({ ...baseSchema, password: z.string().min(10, 'At least 10 characters') })
const editSchema = z.object(baseSchema)

function UserForm({ user, onClose }) {
  const isNew = !user.id
  const qc = useQueryClient()
  const toast = useToast()
  const offices = useAllOffices()
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    resolver: zodResolver(isNew ? createSchema : editSchema),
    defaultValues: {
      username: user.username ?? '', first_name: user.first_name ?? '', last_name: user.last_name ?? '',
      email: user.email ?? '', role: user.role_name ?? '', offices: (user.offices ?? []).map(String), password: '',
    },
  })
  const role = watch('role')
  const save = useMutation({
    mutationFn: (body) => isNew ? api.post('/users/', body) : api.patch(`/users/${user.id}/`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/users/'] })
      toast(isNew ? 'User created. They must change the password at first login.' : 'User updated.')
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, Object.keys(createSchema.shape))),
  })

  return (
    <form noValidate className="grid gap-4 sm:grid-cols-2"
      onSubmit={handleSubmit((v) => save.mutate({ ...v, offices: v.offices.map(Number) }))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">{error}</div>}
      <Field label="Username" htmlFor="username" error={errors.username?.message}>
        <input id="username" className={inputClass} {...register('username')} disabled={!isNew} />
      </Field>
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <input id="email" type="email" className={inputClass} {...register('email')} />
      </Field>
      <Field label="First name" htmlFor="first_name" error={errors.first_name?.message}>
        <input id="first_name" className={inputClass} {...register('first_name')} />
      </Field>
      <Field label="Last name" htmlFor="last_name" error={errors.last_name?.message}>
        <input id="last_name" className={inputClass} {...register('last_name')} />
      </Field>
      <Field label="Role" htmlFor="role" error={errors.role?.message}>
        <select id="role" className={inputClass} {...register('role')}>
          <option value="">Select…</option>
          {ROLES.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
      {isNew && (
        <Field label="Initial password" htmlFor="password" error={errors.password?.message} hint="User must change it at first login.">
          <input id="password" type="password" autoComplete="new-password" className={inputClass} {...register('password')} />
        </Field>
      )}
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">Offices</legend>
        <p className="mb-2 text-xs text-slate-500">
          {role === 'Field Office User'
            ? 'This user can only access records of the offices selected here.'
            : 'This role can access all offices; selection is informational.'}
        </p>
        <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-2">
          {offices.data?.results.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" value={String(o.id)} {...register('offices')} /> {o.code} - {o.name}
            </label>
          ))}
          {offices.data?.results.length === 0 && <span className="text-sm text-slate-500">No offices defined yet.</span>}
        </div>
        {errors.offices && <p className="mt-1 text-sm text-danger">{errors.offices.message}</p>}
      </fieldset>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )
}

function ResetPasswordForm({ user, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: zodResolver(z.object({ new_password: z.string().min(10, 'At least 10 characters') })),
  })
  const reset = useMutation({
    mutationFn: (body) => api.post(`/users/${user.id}/reset-password/`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/users/'] })
      toast(`Temporary password set for ${user.username}.`)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, ['new_password'])),
  })
  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit((v) => reset.mutate(v))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      <Field label="Temporary password" htmlFor="new_password" error={errors.new_password?.message}
        hint="The user will be asked to change it at next login.">
        <input id="new_password" type="password" autoComplete="new-password" className={inputClass} {...register('new_password')} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={reset.isPending}>Set password</Button>
      </div>
    </form>
  )
}
