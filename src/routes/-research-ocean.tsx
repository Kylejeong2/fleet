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
  launching: boolean
  synthesizing: boolean
}

export function ResearchOcean({
  snapshot,
  onOpenAgent,
  launching = false,
}: {
  snapshot?: RunSnapshot
  onOpenAgent?: (agentId: string) => void
  launching?: boolean
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
    launching,
    synthesizing: snapshot?.status === 'synthesizing',
  })
  const openAgent = useRef(onOpenAgent)
  liveState.current = {
    agents,
    complete: snapshot?.status === 'completed',
    launching,
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
    renderer.toneMappingExposure = 1.35

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x03111a, 0.038)
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80)
    camera.position.set(0, 7.6, 14.5)
    camera.lookAt(0, -0.9, -3.4)

    const ambient = new THREE.HemisphereLight(0x9fefff, 0x021018, 1.35)
    scene.add(ambient)
    const keyLight = new THREE.DirectionalLight(0xbafaff, 3.2)
    keyLight.position.set(-6, 10, 7)
    scene.add(keyLight)
    const coreLight = new THREE.PointLight(0x56fff1, 42, 18, 1.7)
    coreLight.position.set(0, 1.6, 1)
    scene.add(coreLight)

    const waterGeometry = new THREE.PlaneGeometry(42, 34, 128, 96)
    const waterMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uEnergy: { value: 0.45 } },
      vertexShader: `
        uniform float uTime;
        varying float vWave;
        varying float vFoam;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;

        float oceanHeight(vec2 point) {
          float swell = sin(dot(point, normalize(vec2(1.0, .26))) * .34 + uTime * .46) * .31;
          float crossing = sin(dot(point, normalize(vec2(-.34, 1.0))) * .58 - uTime * .37) * .18;
          float chop = sin(dot(point, normalize(vec2(.76, .65))) * 1.18 + uTime * .72) * .075;
          float ripple = sin(dot(point, normalize(vec2(-.82, .57))) * 2.35 - uTime * 1.08) * .026;
          return swell + crossing + chop + ripple;
        }

        void main() {
          vUv = uv;
          vec3 p = position;
          p.z += oceanHeight(p.xy);
          vWave = p.z;
          vFoam = smoothstep(.34, .52, p.z);
          float epsilon = .08;
          float slopeX = (oceanHeight(p.xy + vec2(epsilon, 0.0)) - oceanHeight(p.xy - vec2(epsilon, 0.0))) / (2.0 * epsilon);
          float slopeY = (oceanHeight(p.xy + vec2(0.0, epsilon)) - oceanHeight(p.xy - vec2(0.0, epsilon))) / (2.0 * epsilon);
          vWorldNormal = normalize(mat3(modelMatrix) * normalize(vec3(-slopeX, -slopeY, 1.0)));
          vWorldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uEnergy;
        varying float vWave;
        varying float vFoam;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;
        void main() {
          vec3 normal = normalize(vWorldNormal);
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          vec3 sunDirection = normalize(vec3(-.42, .78, .34));
          float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.2);
          float diffuse = max(dot(normal, sunDirection), 0.0);
          float specular = pow(max(dot(reflect(-sunDirection, normal), viewDirection), 0.0), 92.0);
          float horizon = smoothstep(.05, .96, vUv.y);
          float fineFoam = smoothstep(.76, 1.0, sin(vWorldPosition.x * 2.6 - vWorldPosition.z * 1.8 + uTime * .8));
          float foam = vFoam * (.25 + fineFoam * .75);
          vec3 abyss = vec3(.004, .035, .065);
          vec3 waterBlue = vec3(.008, .16, .21);
          vec3 reflectedSky = vec3(.09, .43, .48);
          vec3 color = mix(abyss, waterBlue, diffuse * .54 + horizon * .2);
          color = mix(color, reflectedSky, fresnel * (.42 + uEnergy * .08));
          color += vec3(.42, .96, .91) * specular * (1.15 + uEnergy * .45);
          color += vec3(.34, .86, .82) * foam * (.16 + uEnergy * .08);
          color += vec3(.02, .17, .18) * max(vWave, 0.0) * .32;
          gl_FragColor = vec4(color, .985);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    })
    const water = new THREE.Mesh(waterGeometry, waterMaterial)
    water.rotation.x = -Math.PI / 2
    water.position.set(0, -1.15, -3.4)
    scene.add(water)

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
      const boat = createBoat(preview ? 1.05 : .36)
      boat.userData.agentIndex = index
      boat.userData.progress = preview ? .24 : 0
      boat.userData.velocity = 0
      boats.push(boat)
      scene.add(boat)

      const territory = territories[index % territories.length]!
      const spread = ((Math.floor(index / territories.length) % 7) - 3) * .38
      const destination = preview
        ? new THREE.Vector3(5, -1.02, 5.4)
        : territory.world.clone().add(new THREE.Vector3(spread, 0, (index % 4) * .32))
      const start = preview ? new THREE.Vector3(-5, -1.05, 5.4) : new THREE.Vector3(0, -.52, 5.6)
      const control = preview
        ? new THREE.Vector3(0, -.82, 5)
        : new THREE.Vector3(destination.x * .42 + ((index % 5) - 2) * .32, .55 + (index % 3) * .12, destination.z * .28 + 1.2)
      const curve = new THREE.QuadraticBezierCurve3(start, control, destination)
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
        const targetProgress = preview
          ? state.launching ? .9 : .24
          : agent.status === 'planned'
            ? .025
          : agent.status === 'succeeded'
            ? .1 + (index % 8) * .012
            : agent.status === 'failed'
              ? .78
              : .93
        const travelEase = preview && state.launching ? .035 : .025 + (index % 5) * .002
        boat.userData.progress = THREE.MathUtils.lerp(boat.userData.progress as number, targetProgress, reducedMotion ? 1 : travelEase)
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
  const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x2c8f94, metalness: .22, roughness: .42, emissive: 0x15565c, emissiveIntensity: .72 })
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0xd8fff9, roughness: .36, emissive: 0x3ccfc4, emissiveIntensity: .38 })
  const sailMaterial = new THREE.MeshStandardMaterial({ color: 0xe4fffb, emissive: 0x54dacf, emissiveIntensity: .38, side: THREE.DoubleSide, transparent: true, opacity: .96 })
  const mastMaterial = new THREE.MeshStandardMaterial({ color: 0xb8d7d2, metalness: .32, roughness: .46, emissive: 0x225d5b, emissiveIntensity: .26 })
  const hull = new THREE.Mesh(new THREE.SphereGeometry(.74, 24, 12, 0, Math.PI * 2, 0, Math.PI * .52), hullMaterial)
  hull.scale.set(.48, .34, 1.28)
  hull.rotation.z = Math.PI
  hull.position.y = .04
  hull.userData.boatSurface = true
  boat.add(hull)

  const deck = new THREE.Mesh(new THREE.BoxGeometry(.58, .08, 1.25), trimMaterial)
  deck.position.y = .12
  deck.userData.boatSurface = true
  boat.add(deck)

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.018, .024, 1.42, 10), mastMaterial)
  mast.position.y = .78
  mast.userData.boatSurface = true
  boat.add(mast)

  const mainsail = createSail([
    .025, .28, -.02,
    .025, 1.46, -.02,
    .025, .34, .82,
  ], sailMaterial)
  mainsail.position.y = .04
  boat.add(mainsail)

  const foresail = createSail([
    -.025, .32, -.08,
    -.025, 1.34, -.08,
    -.025, .36, -.7,
  ], sailMaterial)
  foresail.position.y = .04
  boat.add(foresail)

  const wakeMaterial = new THREE.LineBasicMaterial({
    color: 0x79fff4,
    transparent: true,
    opacity: .28,
    blending: THREE.AdditiveBlending,
  })
  boat.add(createWakeTrail(-.2, wakeMaterial), createWakeTrail(.2, wakeMaterial))
  if (scale > 1) {
    const launchLight = new THREE.PointLight(0x69fff2, 18, 6, 1.8)
    launchLight.position.set(0, .8, .1)
    boat.add(launchLight)
  }
  return boat
}

function createSail(points: number[], material: THREE.MeshStandardMaterial): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  geometry.computeVertexNormals()
  const sail = new THREE.Mesh(geometry, material)
  sail.userData.boatSurface = true
  return sail
}

function createWakeTrail(side: number, material: THREE.LineBasicMaterial): THREE.Line {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(side, -.17, -.68),
    new THREE.Vector3(side * 1.55, -.2, -1.35),
    new THREE.Vector3(side * 2.25, -.22, -2.05),
  )
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(18)), material)
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
