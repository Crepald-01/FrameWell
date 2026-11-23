import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'

const cache = new Map()
const react = `
  export default framewellReact;
  export const { Children, cloneElement, createElement, Fragment, isValidElement, memo, useCallback,
    useContext, createContext, useId, useMemo, useReducer, useRef, useState, forwardRef } = framewellReact;
`
const jsx = 'export const { jsx, jsxs, Fragment } = framewellJSX; export const jsxDEV = jsx;'
const sdk = `
  export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  export const lerp = (start, end, t) => start + (end - start) * t;
  export const interpolate = (value, from, to) => lerp(to[0], to[1], clamp((value - from[0]) / (from[1] - from[0])));
  export const easeOut = (t) => 1 - (1 - clamp(t)) ** 3;
  export const easeInOut = (t) => clamp(t) ** 2 * (3 - 2 * clamp(t));
  export const random = (seed) => {
    const n = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
`
const libraries = new Map([['react', react], ['react/jsx-runtime', jsx], ['react/jsx-dev-runtime', jsx], ['@framewell/sdk', sdk]])

export async function compileCode(project, fileId) {
  const file = project.code.find(file => file.id === fileId)
  if (!file || file.kind === 'module') throw new Error('Choose a script or a React clip source.')
  const fingerprint = createHash('sha256').update(JSON.stringify([fileId, project.code])).digest('hex')
  if (cache.has(fingerprint)) return cache.get(fingerprint)
  const files = new Map(project.code.map(file => [file.path, file]))
  const result = await build({
    entryPoints: [file.path],
    bundle: true, write: false, format: 'iife', globalName: 'FramewellProject', platform: 'browser',
    target: 'es2022', jsx: 'automatic', logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'framewell-project-modules',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (args.kind === 'entry-point') return { path: file.path, namespace: 'project' }
          if (libraries.has(args.path)) return { path: args.path, namespace: 'library' }
          if (args.path.startsWith('./') || args.path.startsWith('../')) {
            const target = posix.normalize(posix.join(posix.dirname(args.importer), args.path))
            const resolved = [target, target + '.ts', target + '.tsx', target + '/index.ts'].find(path => files.has(path))
            if (resolved) return { path: resolved, namespace: 'project' }
          }
          return { errors: [{ text: `Unavailable project import: ${args.path}` }] }
        })
        builder.onLoad({ filter: /.*/, namespace: 'library' }, args => ({ contents: libraries.get(args.path), loader: 'js' }))
        builder.onLoad({ filter: /.*/, namespace: 'project' }, args => ({
          contents: files.get(args.path).source, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
        }))
      },
    }],
  })
  const compiled = { key: fingerprint, bundle: result.outputFiles[0].text, kind: file.kind, path: file.path }
  cache.set(fingerprint, compiled)
  if (cache.size > 50) cache.delete(cache.keys().next().value)
  return compiled
}

export async function validateCode(project, editedIds) {
  const moduleIds = new Set(project.code.filter(file => file.kind === 'module').map(file => file.id))
  if (editedIds.some(id => moduleIds.has(id))) {
    const { transform } = await import('esbuild')
    for (const file of project.code.filter(file => editedIds.includes(file.id) && file.kind === 'module')) {
      await transform(file.source, { loader: file.path.endsWith('.tsx') ? 'tsx' : 'ts', sourcefile: file.path, logLevel: 'silent' })
    }
  }
  await Promise.all(project.code.filter(file => file.kind !== 'module').map(file => compileCode(project, file.id)))
}
