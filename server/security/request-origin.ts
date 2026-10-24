export function publicOrigin(value?: string) {
  if (!value) return undefined
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('YZ_PUBLIC_ORIGIN 必须是 HTTPS 网站地址，不能包含路径或凭据。')
  return url.origin
}

export function allowedRequest(host: string, origin: string | undefined, requestHost: string | undefined, deployedOrigin?: string) {
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host)
  const deployed = deployedOrigin ? new URL(deployedOrigin) : undefined
  if (!local && host !== deployed?.hostname) return 'HOST_REJECTED'
  if (origin && ![
    'http://127.0.0.1:5188', 'http://localhost:5188',
    'http://127.0.0.1:5189', 'http://localhost:5189',
    ...(local ? [`http://${requestHost}`] : []),
    ...(deployed ? [deployed.origin] : []),
  ].includes(origin)) return 'ORIGIN_REJECTED'
  return null
}
