import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Trash2, Upload } from 'lucide-react'
import { api, errorMessage, invalidatePrefix } from '../api'
import { Button, ConfirmDialog } from './ui'
import { useToast } from './toast'

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp']
const MAX_MB = 5 // matches VEHICLE_PHOTO_MAX_BYTES default; the server enforces the real limit

/**
 * Upload / change / remove the photo of a record served by fleet/photos.py (POST/DELETE {basePath}/photo/).
 * current: what to show when no new file is picked (photo or placeholder). frame: classes for the preview box.
 */
export default function PhotoUpload({ basePath, detailKey, listPrefix, photoUrl, canChange, noun, current, frame = 'aspect-[4/3]' }) {
  const qc = useQueryClient()
  const toast = useToast()
  const input = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  const done = (data, msg) => {
    qc.setQueryData(detailKey, data)
    invalidatePrefix(qc, listPrefix)
    toast(msg)
    setFile(null); setPreview(null); setProgress(0)
  }

  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData()
      body.append('photo', file)
      return api.post(`${basePath}/photo/`, body, {
        onUploadProgress: (e) => e.total && setProgress(Math.round((e.loaded / e.total) * 100)),
      })
    },
    onSuccess: ({ data }) => done(data, photoUrl ? 'Photo replaced.' : 'Photo uploaded.'),
    onError: (err) => { setError(errorMessage(err)); setProgress(0) },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`${basePath}/photo/`),
    onSuccess: ({ data }) => { done(data, 'Photo removed.'); setConfirmRemove(false) },
    onError: (err) => { toast(errorMessage(err), 'error'); setConfirmRemove(false) },
  })

  const pick = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError('')
    if (!ACCEPT.includes(f.type)) return setError('Choose a JPEG, PNG or WebP image.')
    if (f.size > MAX_MB * 1024 * 1024) return setError(`Photo must be ${MAX_MB} MB or smaller.`)
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  return (
    <div>
      {preview
        ? <div className={`${frame} overflow-hidden rounded-md bg-white ring-2 ring-gold`}><img src={preview} alt="Preview of the new photo" className="h-full w-full object-contain" /></div>
        : current}

      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {upload.isPending && (
        <div className="mt-3 h-2 overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
          <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {canChange && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input ref={input} type="file" accept={ACCEPT.join(',')} className="hidden" onChange={pick} aria-label={`Choose ${noun} photo`} />
          {file ? (
            <>
              <Button onClick={() => upload.mutate()} disabled={upload.isPending}><Upload size={16} /> {upload.isPending ? `Uploading ${progress}%` : 'Save photo'}</Button>
              <Button variant="secondary" onClick={() => { setFile(null); setPreview(null) }} disabled={upload.isPending}>Cancel</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => input.current.click()}>
                <ImagePlus size={16} /> {photoUrl ? 'Change photo' : 'Upload photo'}
              </Button>
              {photoUrl && <Button variant="ghost" className="text-danger" onClick={() => setConfirmRemove(true)}><Trash2 size={16} /> Remove</Button>}
            </>
          )}
        </div>
      )}
      {canChange && !file && <p className="mt-2 text-xs text-slate-500">JPEG, PNG or WebP, up to {MAX_MB} MB.</p>}

      <ConfirmDialog open={confirmRemove} title="Remove photo" message={`The ${noun} photo will be deleted. This is recorded in the audit trail.`}
        confirmLabel="Remove" danger busy={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setConfirmRemove(false)} />
    </div>
  )
}
