import type { SVGProps } from 'react'

export function Instagram({ size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><rect width="20" height="20" x="2" y="2" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" /></svg>
}
