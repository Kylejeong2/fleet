import { useEffect, useMemo, useRef, type CSSProperties, type MutableRefObject } from 'react'
import { useReducedMotion } from 'motion/react'
import * as THREE from 'three'
import type { AgentSnapshot, RunSnapshot } from '../lib/fleet-protocol'

const MAX_VISIBLE_BOATS = 50

const territories = [
  { x: 13, y: 27, world: new THREE.Vector3(-8.4, 0, -5.8) },
  { x: 32, y: 15, world: new THREE.Vector3(-4.2, 0, -8.5) },
  { x: 68, y: 15, world: new THREE.Vector3(4.2, 0, -8.5) },
  { x: 87, y: 27, world: new THREE.Vector3(8.4, 0, -5.8) },
  { x: 82, y: 67, world: new THREE.Vector3(7.1, 0, 1.6) },
  { x: 18, y: 67, world: new THREE.Vector3(-7.1, 0, 1.6) },
] as const

type OceanAgent = {
  id: string | null
  status: AgentSnapshot['status'] | 'preview'
  retrying: boolean
}

type OceanState = {
  agents: OceanAgent[]
  complete: boolean
  synthesizing: boolean
}

export function ResearchOcean({
  snapshot,
  onOpenAgent,
}: {
  snapshot?: RunSnapshot
  onOpenAgent?: (agentId: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const agents = useMemo<OceanAgent[]>(() => {
    if (!snapshot) return [{ id: null, status: 'preview', retrying: false }]
    return Array.from({ length: Math.min(snapshot.agentCount, MAX_VISIBLE_BOATS) }, (_, index) => {
      const agent = snapshot.agents[index]
      return {
        id: agent?.id ?? null,
        status: agent?.status ?? 'planned',
        retrying: agent?.status === 'running' && agent.activity.toLowerCase().includes('retry'),
      }
    })
  }, [snapshot])
  const liveState = useRef<OceanState>({
    agents,
    complete: snapshot?.status === 'completed',
    synthesizing: snapshot?.status === 'synthesizing',
  })
  const openAgent = useRef(onOpenAgent)
  liveState.current = {
    agents,
    complete: snapshot?.status === 'completed',
    synthesizing: snapshot?.status === 'synthesizing',
  }
  openAgent.current = onOpenAgent

  useThreeOcean(canvasRef, liveState, openAgent, Boolean(prefersReducedMotion), agents.length)

  const completed = snapshot?.agents.filter((agent) => agent.status === 'succeeded').length ?? 0
  const active = snapshot?.agents.filter((agent) => agent.status === 'running').length ?? 0
  const sources = snapshot ? oceanSources(snapshot.agents).slice(0, 5) : []
  const state = !snapshot
    ? 'ready'
    : snapshot.status === 'completed'
      ? 'complete'
      : snapshot.status === 'synthesizing'
        ? 'synthesizing'
        : 'researching'

  return (
    <section
      className={`research-ocean ${state}`}
      aria-label={snapshot ? `Research map: ${active} agents active and ${completed} complete` : 'Research territories preview'}
    >
      <canvas ref={canvasRef} className="ocean-canvas" aria-hidden="true" />
      <div className="ocean-vignette" aria-hidden="true" />
      <div className="ocean-horizon" aria-hidden="true" />

      {snapshot ? (
        <div className="ocean-agent-access" aria-label="Research agents">
          {agents.flatMap((agent, index) => {
            if (!agent.id) return []
            const territory = territories[index % territories.length]!
            const spread = ((Math.floor(index / territories.length) % 7) - 3) * 1.1
            const isReturned = agent.status === 'succeeded'
            const style = {
              '--agent-x': `${isReturned ? 50 + spread : territory.x + spread}%`,
              '--agent-y': `${isReturned ? 58 + (index % 4) * 1.2 : territory.y + 8 + (index % 4) * 2}%`,
            } as CSSProperties
            return (
              <button
                className={`ocean-agent-target ${agent.status} ${agent.retrying ? 'retrying' : ''}`}
                key={agent.id}
                type="button"
                style={style}
                onClick={() => openAgent.current?.(agent.id!)}
                aria-label={`Open researcher ${index + 1} trace, ${agent.retrying ? 'retrying' : agent.status}`}
              >
                <span>A{index + 1}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {sources.length ? (
        <details className="ocean-source-disclosure">
          <summary>{sources.length} source {sources.length === 1 ? 'website' : 'websites'}</summary>
          <div className="ocean-source-stream" aria-label="Live source websites">
            {sources.map((source, index) => (
              <a
                href={source.url}
                key={source.domain}
                target="_blank"
                rel="noreferrer"
                title={source.url}
                style={{ '--source-index': index } as CSSProperties}
              >
                {displayDomain(source.domain)}
              </a>
            ))}
          </div>
        </details>
      ) : null}

    </section>
  )
}

function useThreeOcean(
  canvasRef: MutableRefObject<HTMLCanvasElement | null>,
  liveState: MutableRefObject<OceanState>,
  onOpenAgent: MutableRefObject<((agentId: string) => void) | undefined>,
  reducedMotion: boolean,
  boatCount: number,
) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.25

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x020b12, 0.048)
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80)
    camera.position.set(0, 7.6, 14.5)
    camera.lookAt(0, -0.9, -3.4)

    const ambient = new THREE.HemisphereLight(0x8defff, 0x021018, 1.2)
    scene.add(ambient)
    const keyLight = new THREE.DirectionalLight(0xbafaff, 3.2)
    keyLight.position.set(-6, 10, 7)
    scene.add(keyLight)
    const coreLight = new THREE.PointLight(0x56fff1, 42, 18, 1.7)
    coreLight.position.set(0, 1.6, 1)
    scene.add(coreLight)

    const waterGeometry = new THREE.PlaneGeometry(38, 30, 96, 76)
    const waterMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uEnergy: { value: 0.45 } },
      vertexShader: `
        uniform float uTime;
        varying float vWave;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          float broad = sin(p.x * .42 + uTime * .55) * .22;
          float cross = sin(p.y * .62 - uTime * .38 + p.x * .14) * .16;
          float detail = sin((p.x + p.y) * 1.35 + uTime * .8) * .045;
          p.z += broad + cross + detail;
          vWave = p.z;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uEnergy;
        varying float vWave;
        varying vec2 vUv;
        void main() {
          vec3 deep = vec3(.008, .055, .09);
          vec3 mid = vec3(.018, .20, .23);
          vec3 crest = vec3(.16, .91, .83);
          float horizon = smoothstep(.02, .92, vUv.y);
          float shimmer = pow(max(0.0, vWave + .22), 2.0) * (1.5 + uEnergy);
          float scan = smoothstep(.965, 1.0, sin((vUv.x - vUv.y) * 80.0 + uTime * 1.7));
          vec3 color = mix(deep, mid, horizon * .7) + crest * shimmer + crest * scan * .055;
          gl_FragColor = vec4(color, .96);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    })
    const water = new THREE.Mesh(waterGeometry, waterMaterial)
    water.rotation.x = -Math.PI / 2
    water.position.set(0, -1.15, -3.4)
    scene.add(water)

    const grid = new THREE.GridHelper(38, 54, 0x39d8cc, 0x185566)
    grid.position.set(0, -0.92, -3.4)
    const gridMaterial = grid.material as THREE.Material
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.13
    scene.add(grid)

    const starGeometry = new THREE.BufferGeometry()
    const starPositions = new Float32Array(720 * 3)
    for (let index = 0; index < 720; index += 1) {
      starPositions[index * 3] = (Math.random() - .5) * 38
      starPositions[index * 3 + 1] = 1.5 + Math.random() * 13
      starPositions[index * 3 + 2] = -18 + Math.random() * 26
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
      color: 0xa7fff7,
      size: .035,
      opacity: .72,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }))
    scene.add(stars)

    const boats: THREE.Group[] = []
    const routes: THREE.Line[] = []
    for (let index = 0; index < boatCount; index += 1) {
      const preview = boatCount === 1 && liveState.current.agents[0]?.status === 'preview'
      const boat = createBoat(preview ? 1.25 : .36)
      boat.userData.agentIndex = index
      boat.userData.progress = preview ? .08 : 0
      boat.userData.velocity = 0
      boats.push(boat)
      scene.add(boat)

      const territory = territories[index % territories.length]!
      const spread = ((Math.floor(index / territories.length) % 7) - 3) * .38
      const destination = territory.world.clone().add(new THREE.Vector3(spread, 0, (index % 4) * .32))
      const control = new THREE.Vector3(destination.x * .42 + ((index % 5) - 2) * .32, .55 + (index % 3) * .12, destination.z * .28 + 1.2)
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -.52, 5.6), control, destination)
      boat.userData.curve = curve
      const routeGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(44))
      const routeMaterial = new THREE.LineBasicMaterial({ color: 0x4beadd, transparent: true, opacity: preview ? 0 : .06, blending: THREE.AdditiveBlending })
      const route = new THREE.Line(routeGeometry, routeMaterial)
      route.userData.agentIndex = index
      routes.push(route)
      scene.add(route)
    }

    const pointer = new THREE.Vector2()
    const targetPointer = new THREE.Vector2()
    const raycaster = new THREE.Raycaster()
    const updatePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      targetPointer.copy(pointer)
    }
    const intersectAgent = () => {
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(boats, true)
      for (const hit of hits) {
        let current: THREE.Object3D | null = hit.object
        while (current && typeof current.userData.agentIndex !== 'number') current = current.parent
        if (current) return current.userData.agentIndex as number
      }
      return null
    }
    const onPointerMove = (event: PointerEvent) => {
      updatePointer(event)
      const index = intersectAgent()
      canvas.style.cursor = index !== null && liveState.current.agents[index]?.id ? 'pointer' : 'default'
    }
    const onPointerUp = (event: PointerEvent) => {
      updatePointer(event)
      const index = intersectAgent()
      const agentId = index === null ? null : liveState.current.agents[index]?.id
      if (agentId) onOpenAgent.current?.(agentId)
    }
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false)
      camera.aspect = rect.width / Math.max(1, rect.height)
      camera.updateProjectionMatrix()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    resize()

    const timer = new THREE.Timer()
    timer.connect(document)
    let animationFrame = 0
    const render = (timestamp?: number) => {
      timer.update(timestamp)
      const elapsed = timer.getElapsed()
      const state = liveState.current
      waterMaterial.uniforms.uTime!.value = reducedMotion ? 0 : elapsed
      waterMaterial.uniforms.uEnergy!.value = state.synthesizing ? 1.35 : state.complete ? .82 : .48
      stars.rotation.y = reducedMotion ? 0 : elapsed * .006
      coreLight.intensity = 36 + Math.sin(elapsed * 1.4) * 7 + (state.synthesizing ? 24 : 0)

      boats.forEach((boat, index) => {
        const agent = state.agents[index]
        if (!agent) return
        const preview = agent.status === 'preview'
        const targetProgress = preview || agent.status === 'planned'
          ? .025
          : agent.status === 'succeeded'
            ? .1 + (index % 8) * .012
            : agent.status === 'failed'
              ? .78
              : .93
        boat.userData.progress = THREE.MathUtils.lerp(boat.userData.progress as number, targetProgress, reducedMotion ? 1 : .025 + (index % 5) * .002)
        const curve = boat.userData.curve as THREE.QuadraticBezierCurve3
        const progress = boat.userData.progress as number
        const point = curve.getPoint(progress)
        const tangent = curve.getTangent(progress)
        boat.position.copy(point)
        boat.position.y += reducedMotion ? 0 : Math.sin(elapsed * 1.75 + index * .61) * (preview ? .13 : .045)
        boat.rotation.y = Math.atan2(tangent.x, tangent.z)
        boat.rotation.z = reducedMotion ? 0 : Math.sin(elapsed * 1.3 + index) * .035
        const failed = agent.status === 'failed' || agent.retrying
        setBoatColor(boat, failed ? 0xff4f5e : agent.status === 'succeeded' ? 0xffd76a : 0x72fff2)
        boat.visible = preview || agent.status !== 'planned' || index < 12

        const route = routes[index]
        if (!route) return
        const routeMaterial = route.material as THREE.LineBasicMaterial
        routeMaterial.color.setHex(failed ? 0xff334c : agent.status === 'succeeded' ? 0xffd76a : 0x4beadd)
        routeMaterial.opacity = preview ? 0 : agent.status === 'planned' ? .035 : agent.status === 'running' ? .58 : .3
      })

      if (!reducedMotion) {
        camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetPointer.x * .8, .025)
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, 7.6 + targetPointer.y * .34, .025)
        camera.lookAt(0, -.9, -3.4)
      }
      renderer.render(scene, camera)
      animationFrame = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(animationFrame)
      timer.dispose()
      resizeObserver.disconnect()
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        }
      })
      renderer.dispose()
    }
  }, [boatCount, canvasRef, liveState, onOpenAgent, reducedMotion])
}

function createBoat(scale: number): THREE.Group {
  const boat = new THREE.Group()
  boat.scale.setScalar(scale)
  const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x164e5a, metalness: .55, roughness: .24, emissive: 0x0c4851, emissiveIntensity: .9 })
  const sailMaterial = new THREE.MeshStandardMaterial({ color: 0xbafff9, emissive: 0x4effef, emissiveIntensity: 1.4, side: THREE.DoubleSide, transparent: true, opacity: .94 })
  const hull = new THREE.Mesh(new THREE.SphereGeometry(.74, 24, 12, 0, Math.PI * 2, 0, Math.PI * .52), hullMaterial)
  hull.scale.set(1.25, .34, .52)
  hull.rotation.z = Math.PI
  hull.position.y = .02
  hull.userData.boatSurface = true
  boat.add(hull)
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.018, .025, 1.42, 8), sailMaterial)
  mast.position.y = .78
  mast.userData.boatSurface = true
  boat.add(mast)
  const sailGeometry = new THREE.BufferGeometry()
  sailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    .03, .25, 0,
    .03, 1.48, 0,
    .76, .35, 0,
  ], 3))
  sailGeometry.computeVertexNormals()
  const sail = new THREE.Mesh(sailGeometry, sailMaterial)
  sail.position.y = .04
  sail.userData.boatSurface = true
  boat.add(sail)
  const wake = new THREE.Mesh(
    new THREE.RingGeometry(.46, .5, 32, 1, 0, Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x6ffff3, transparent: true, opacity: .34, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  )
  wake.rotation.x = -Math.PI / 2
  wake.rotation.z = Math.PI / 2
  wake.position.set(0, -.14, .56)
  boat.add(wake)
  if (scale > 1) {
    const launchLight = new THREE.PointLight(0x69fff2, 32, 7, 1.8)
    launchLight.position.set(0, 1.1, .2)
    boat.add(launchLight)
  }
  return boat
}

function setBoatColor(boat: THREE.Group, color: number) {
  boat.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData.boatSurface) return
    const material = object.material as THREE.MeshStandardMaterial
    material.emissive.setHex(color)
  })
}

function oceanSources(agents: AgentSnapshot[]): Array<{ domain: string; url: string }> {
  const sources = new Map<string, string>()
  for (const agent of agents) {
    for (const trace of agent.trace) {
      if (trace.status !== 'succeeded') continue
      const urls = trace.result.kind === 'search'
        ? trace.result.results.map((result) => result.url)
        : [trace.result.url]
      for (const url of urls) {
        try {
          const domain = new URL(url).hostname.replace(/^www\./, '')
          if (!sources.has(domain)) sources.set(domain, url)
        } catch {
          // Public URLs are validated by the protocol; ignore malformed display values defensively.
        }
      }
    }
  }
  return [...sources].map(([domain, url]) => ({ domain, url }))
}

function displayDomain(domain: string): string {
  return domain.length > 21 ? `${domain.slice(0, 20)}…` : domain
}
