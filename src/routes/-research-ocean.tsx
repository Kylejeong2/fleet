import { useEffect, useMemo, useRef, type CSSProperties, type MutableRefObject } from 'react'
import { useReducedMotion } from 'motion/react'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { AgentSnapshot, RunSnapshot } from '../lib/fleet-protocol'

const MAX_VISIBLE_BOATS = 50
const FLEET_REVEAL_DELAY_SECONDS = .18
const FLEET_LAUNCH_SECONDS = 2.8
const FLEET_RETURN_SECONDS = 2.2

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
  status: AgentSnapshot['status']
  retrying: boolean
}

type OceanState = {
  agents: OceanAgent[]
  complete: boolean
  synthesizing: boolean
  phase: 'hero' | 'morphing' | 'fleet'
}

export function ResearchOcean({
  snapshot,
  phase = snapshot ? 'fleet' : 'hero',
  onOpenAgent,
}: {
  snapshot?: RunSnapshot
  phase?: OceanState['phase']
  onOpenAgent?: (agentId: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const agents = useMemo<OceanAgent[]>(() => {
    if (!snapshot) return []
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
    phase,
  })
  const openAgent = useRef(onOpenAgent)
  useEffect(() => {
    liveState.current = {
      agents,
      complete: snapshot?.status === 'completed',
      synthesizing: snapshot?.status === 'synthesizing',
      phase,
    }
  }, [agents, phase, snapshot?.status])
  useEffect(() => {
    openAgent.current = onOpenAgent
  }, [onOpenAgent])

  useThreeOcean(canvasRef, liveState, openAgent, Boolean(prefersReducedMotion))

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
      <div className="ocean-atmosphere" aria-hidden="true" />
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
          <summary>Showing {sources.length} {sources.length === 1 ? 'source' : 'sources'}</summary>
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
) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.16
    renderer.setClearColor(0x000103, 1)

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x04121b, .026)
    const camera = new THREE.PerspectiveCamera(44, 1, .1, 90)
    camera.position.set(0, 6.4, 14.8)
    const cameraTarget = new THREE.Vector3(0, -.7, -4.8)
    camera.lookAt(cameraTarget)

    const composer = new EffectComposer(renderer)
    const renderPass = new RenderPass(scene, camera)
    composer.addPass(renderPass)
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .46, .62, .78)
    composer.addPass(bloom)

    const sky = createSky()
    scene.add(sky)

    const ambient = new THREE.HemisphereLight(0x92dbea, 0x010811, 1.55)
    scene.add(ambient)
    const moonLight = new THREE.DirectionalLight(0xc5f7ff, 3.6)
    moonLight.position.set(8, 13, -8)
    scene.add(moonLight)
    const horizonLight = new THREE.PointLight(0x59e8dc, 50, 25, 1.7)
    horizonLight.position.set(-1.5, 2.1, -7)
    scene.add(horizonLight)

    const softTexture = createSoftTexture()
    const moon = createMoon(softTexture)
    moon.position.set(8.4, 8.1, -24)
    scene.add(moon)

    const stars = createStars(1100)
    scene.add(stars)
    const seaSparkles = createSeaSparkles(430, softTexture)
    scene.add(seaSparkles)
    const mist = createMist(softTexture, true)
    scene.add(mist)
    const heroWaterGeometry = new THREE.PlaneGeometry(54, 42, 128, 96)
    const fleetWaterGeometry = new THREE.PlaneGeometry(54, 42, 96, 72)
    const waterMaterial = createWaterMaterial(true)
    const water = new THREE.Mesh(heroWaterGeometry, waterMaterial)
    water.rotation.x = -Math.PI / 2
    water.position.set(0, -1.15, -4.8)
    scene.add(water)

    const dock = createHarborDock()
    scene.add(dock)
    const dockMaterials: THREE.Material[] = []
    dock.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        material.transparent = true
        dockMaterials.push(material)
      }
    })

    const destinationPins: THREE.Group[] = []
    for (let index = 0; index < territories.length; index += 1) {
      const territory = territories[index]!
      const outward = territory.world.clone().setY(0).normalize()
      const lateral = new THREE.Vector3(-outward.z, 0, outward.x)
        .multiplyScalar(index % 2 === 0 ? 1.45 : -1.45)
      const pin = createDestinationPin()
      pin.position.copy(territory.world)
        .add(outward.multiplyScalar(.82))
        .add(lateral)
      pin.position.y = -.43
      pin.userData.agentIndex = index
      pin.userData.baseY = pin.position.y
      destinationPins.push(pin)
      scene.add(pin)
    }

    const previewBoat = createBoat(.65)
    const heroBoatPosition = new THREE.Vector3(4.75, -.79, 3.05)
    const harborBoatPosition = new THREE.Vector3(0, -.52, 5.6)
    previewBoat.rotation.y = -.9
    scene.add(previewBoat)
    const boats: THREE.Object3D[] = []
    const routes: THREE.Line[] = []
    const scratchColor = new THREE.Color()
    const fleetBoats = createFleetBoatInstances(MAX_VISIBLE_BOATS)
    scene.add(fleetBoats)
    for (let index = 0; index < MAX_VISIBLE_BOATS; index += 1) {
      const boat = new THREE.Object3D()
      boat.scale.setScalar(0)
      boat.userData.agentIndex = index
      boat.userData.progress = 0
      boats.push(boat)

      const territory = territories[index % territories.length]!
      const spread = ((Math.floor(index / territories.length) % 7) - 3) * .38
      const destination = territory.world.clone().add(new THREE.Vector3(spread, 0, (index % 4) * .32))
      const start = new THREE.Vector3(0, -.52, 5.6)
      const control = new THREE.Vector3(destination.x * .42 + ((index % 5) - 2) * .32, .55 + (index % 3) * .12, destination.z * .28 + 1.2)
      const curve = new THREE.QuadraticBezierCurve3(start, control, destination)
      boat.userData.curve = curve
      const routeGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(44))
      const routeMaterial = new THREE.LineBasicMaterial({ color: 0x4beadd, transparent: true, opacity: .06, blending: THREE.AdditiveBlending })
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
      if (fleetBoats) {
        fleetBoats.computeBoundingSphere()
        const hit = raycaster.intersectObject(fleetBoats, false)[0]
        return hit?.instanceId ?? null
      }
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

    let renderWidth = 0
    let renderHeight = 0
    const resizeCanvas = (force = false) => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      if (!force && width === renderWidth && height === renderHeight) return
      renderWidth = width
      renderHeight = height
      if (liveState.current.phase === 'hero') {
        const narrow = width < 620
        heroBoatPosition.set(narrow ? 1.25 : 4.75, narrow ? -.84 : -.79, narrow ? 4.75 : 3.05)
        previewBoat.rotation.y = narrow ? -.68 : -.9
      }
      renderer.setSize(width, height, false)
      composer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resizeCanvas(true)

    const timer = new THREE.Timer()
    timer.connect(document)
    let animationFrame = 0
    let scenePhase = liveState.current.phase
    let morphStartedAt = 0
    let usingFleetWater = false
    const render = (timestamp?: number) => {
      timer.update(timestamp)
      const elapsed = timer.getElapsed()
      const motionTime = reducedMotion ? 0 : elapsed
      const state = liveState.current
      resizeCanvas()
      if (state.phase !== scenePhase) {
        scenePhase = state.phase
        if (scenePhase === 'morphing') morphStartedAt = elapsed
        if (scenePhase === 'fleet') resizeCanvas()
      }
      const rawMorph = state.phase === 'hero'
        ? 0
        : state.phase === 'fleet'
          ? 1
          : THREE.MathUtils.clamp((elapsed - morphStartedAt) / 1.8, 0, 1)
      const morph = reducedMotion ? (state.phase === 'hero' ? 0 : 1) : smootherStep(rawMorph)
      const heroRetire = smootherStep(THREE.MathUtils.clamp((morph - .32) / .24, 0, 1))
      const harborReveal = smootherStep(THREE.MathUtils.clamp((morph - .48) / .2, 0, 1))
      const fleetReveal = smootherStep(THREE.MathUtils.clamp((morph - .68) / .32, 0, 1))
      if (morph > .72 && !usingFleetWater) {
        water.geometry = fleetWaterGeometry
        usingFleetWater = true
      } else if (morph <= .72 && usingFleetWater) {
        water.geometry = heroWaterGeometry
        usingFleetWater = false
      }
      waterMaterial.uniforms.uTime!.value = motionTime
      waterMaterial.uniforms.uEnergy!.value = state.synthesizing ? 1.35 : state.complete ? .8 : .48
      waterMaterial.uniforms.uHero!.value = 1 - morph
      ;(sky.material as THREE.ShaderMaterial).uniforms.uTime!.value = motionTime
      ;(scene.fog as THREE.FogExp2).density = THREE.MathUtils.lerp(.026, .034, morph)
      renderer.toneMappingExposure = THREE.MathUtils.lerp(1.16, 1.26, morph)
      camera.fov = THREE.MathUtils.lerp(44, 42, morph)
      camera.updateProjectionMatrix()
      stars.rotation.y = reducedMotion ? 0 : elapsed * .004
      seaSparkles.rotation.y = reducedMotion ? 0 : Math.sin(elapsed * .03) * .08
      seaSparkles.position.y = reducedMotion ? 0 : Math.sin(elapsed * .21) * .035
      mist.children.forEach((cloud, index) => {
        cloud.visible = morph < .8 || index < 9
        if (reducedMotion) return
        cloud.position.x += (index % 2 ? 1 : -1) * .0007
        cloud.position.y += Math.sin(elapsed * .16 + index) * .00025
      })
      horizonLight.intensity = THREE.MathUtils.lerp(46, 34, morph) + Math.sin(elapsed * .7) * 4 + (state.synthesizing ? 18 : 0)
      bloom.strength = THREE.MathUtils.lerp(.42, .27, morph) + (state.synthesizing ? .14 : 0)

      previewBoat.position.copy(heroBoatPosition).lerp(harborBoatPosition, morph)
      previewBoat.position.x += reducedMotion ? 0 : Math.sin(elapsed * .11) * .1 * (1 - morph)
      previewBoat.position.y += reducedMotion ? 0 : Math.sin(elapsed * 1.35) * .05
      previewBoat.rotation.y = THREE.MathUtils.lerp(-.9, 0, morph)
      previewBoat.rotation.z = reducedMotion ? 0 : Math.sin(elapsed * 1.05) * .025
      previewBoat.scale.setScalar(.65 * (1 - heroRetire))
      previewBoat.visible = heroRetire < 1
      dockMaterials.forEach((material) => { material.opacity = harborReveal })
      dock.visible = harborReveal > .01

      boats.forEach((boat, index) => {
        const agent = state.agents[index]
        const route = routes[index]
        if (!agent) {
          boat.scale.setScalar(0)
          boat.updateMatrix()
          fleetBoats.setMatrixAt(index, boat.matrix)
          if (route) route.visible = false
          return
        }

        const dockProgress = .018 + (index % 3) * .004
        const outboundProgress = .84 + (index % 5) * .012
        const returnedProgress = .1 + (index % 8) * .012
        let progress: number
        let routeReveal = 0
        if (reducedMotion) {
          progress = agent.status === 'planned'
            ? dockProgress
            : agent.status === 'succeeded'
              ? returnedProgress
              : agent.status === 'failed'
                ? .78
                : outboundProgress
          routeReveal = 1
        } else if (agent.status === 'planned') {
          boat.userData.launchAt = undefined
          boat.userData.returnAt = undefined
          progress = THREE.MathUtils.lerp(boat.userData.progress as number, dockProgress, .08)
        } else {
          if (typeof boat.userData.launchAt !== 'number') {
            const stagger = (index % 10) * .08 + Math.floor(index / 10) * .035
            boat.userData.launchAt = elapsed + FLEET_REVEAL_DELAY_SECONDS + stagger
          }
          const launchTime = THREE.MathUtils.clamp(
            (elapsed - (boat.userData.launchAt as number)) / FLEET_LAUNCH_SECONDS,
            0,
            1,
          )
          routeReveal = smootherStep(launchTime)
          progress = THREE.MathUtils.lerp(dockProgress, outboundProgress, routeReveal)
          if (launchTime >= 1 && agent.status === 'succeeded') {
            if (typeof boat.userData.returnAt !== 'number') boat.userData.returnAt = elapsed
            const returnTime = THREE.MathUtils.clamp(
              (elapsed - (boat.userData.returnAt as number)) / FLEET_RETURN_SECONDS,
              0,
              1,
            )
            progress = THREE.MathUtils.lerp(outboundProgress, returnedProgress, smootherStep(returnTime))
          } else if (launchTime >= 1 && agent.status === 'failed') {
            progress = THREE.MathUtils.lerp(outboundProgress, .78, .35)
          }
        }
        boat.userData.progress = progress
        const curve = boat.userData.curve as THREE.QuadraticBezierCurve3
        const point = curve.getPoint(progress)
        const tangent = curve.getTangent(progress)
        boat.position.copy(point)
        boat.position.y += reducedMotion ? 0 : Math.sin(elapsed * 1.75 + index * .61) * .045
        boat.rotation.y = THREE.MathUtils.clamp(Math.atan2(tangent.x, tangent.z), -.9, .9)
        boat.rotation.z = reducedMotion ? 0 : Math.sin(elapsed * 1.3 + index) * .035
        const failed = agent.status === 'failed' || agent.retrying
        const returned = agent.status === 'succeeded'
          && (reducedMotion || typeof boat.userData.returnAt === 'number')
        boat.visible = agent.status !== 'planned' || index < 12
        const color = failed ? 0xff4f5e : returned ? 0xffd76a : 0x72fff2
        if (boat.userData.color !== color) {
          fleetBoats.setColorAt(index, scratchColor.setHex(color))
          boat.userData.color = color
          if (fleetBoats.instanceColor) fleetBoats.instanceColor.needsUpdate = true
        }
        boat.scale.setScalar(boat.visible ? .34 * fleetReveal : 0)
        boat.updateMatrix()
        fleetBoats.setMatrixAt(index, boat.matrix)

        if (!route) return
        route.visible = fleetReveal > .01
        const routeMaterial = route.material as THREE.LineBasicMaterial
        routeMaterial.color.setHex(failed ? 0xff334c : returned ? 0xffd76a : 0x4beadd)
        const routeOpacity = agent.status === 'planned' ? .035 : agent.status === 'running' ? .48 : .24
        routeMaterial.opacity = routeOpacity * (.06 + routeReveal * .94) * fleetReveal
      })

      destinationPins.forEach((pin, index) => {
        const agent = state.agents[index]
        pin.visible = Boolean(agent) && fleetReveal > .01
        if (!agent) return
        const failed = agent?.status === 'failed' || agent?.retrying
        const color = failed ? 0xff4f5e : agent?.status === 'succeeded' ? 0xffd76a : 0x72fff2
        const pulse = reducedMotion ? 1 : 1 + Math.sin(elapsed * 1.65 + index * .8) * .055
        pin.scale.setScalar(pulse)
        pin.position.y = (pin.userData.baseY as number) + (reducedMotion ? 0 : Math.sin(elapsed * 1.2 + index) * .045)
        if (pin.userData.color !== color) {
          setDestinationPinColor(pin, color)
          pin.userData.color = color
        }
      })

      fleetBoats.instanceMatrix.needsUpdate = true

      if (!reducedMotion) {
        dock.position.y = Math.sin(elapsed * .72) * .012
      }

      if (!reducedMotion) {
        camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetPointer.x * THREE.MathUtils.lerp(.62, .7, morph), .018)
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, THREE.MathUtils.lerp(6.4, 7.4, morph) + targetPointer.y * .26, .018)
        camera.position.z = THREE.MathUtils.lerp(14.8, 14.2, morph)
        cameraTarget.y = THREE.MathUtils.lerp(-.7, -.9, morph)
        cameraTarget.z = THREE.MathUtils.lerp(-4.8, -3.8, morph)
        camera.lookAt(cameraTarget)
      }
      composer.render()
      animationFrame = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(animationFrame)
      timer.dispose()
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        } else if (object instanceof THREE.Sprite) {
          object.material.dispose()
        }
      })
      heroWaterGeometry.dispose()
      fleetWaterGeometry.dispose()
      waterMaterial.dispose()
      softTexture.dispose()
      renderPass.dispose()
      bloom.dispose()
      composer.dispose()
      renderer.dispose()
    }
  }, [canvasRef, liveState, onOpenAgent, reducedMotion])
}

function smootherStep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10)
}

function createSky(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(48, 40, 24),
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vDirection;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
        }
        void main() {
          float height = clamp(vDirection.y * .5 + .5, 0.0, 1.0);
          float horizonDelta = (height - .46) * 7.0;
          float horizon = exp(-(horizonDelta * horizonDelta));
          vec3 zenith = vec3(.0002, .0005, .0015);
          vec3 middle = vec3(.001, .004, .009);
          vec3 horizonColor = vec3(.004, .013, .021);
          vec3 color = mix(zenith, middle, smoothstep(.28, .68, 1.0 - height));
          color = mix(color, horizonColor, horizon * .5);
          float auroraNoise = noise(vDirection.xz * 3.5 + vec2(uTime * .018, 0.0));
          float aurora = smoothstep(.55, .9, auroraNoise) * smoothstep(.42, .7, height) * (1.0 - smoothstep(.64, .94, height));
          color += vec3(.01, .08, .085) * aurora * .08;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  )
}

function createWaterMaterial(hero: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: .48 },
      uHero: { value: hero ? 1 : 0 },
    },
    vertexShader: `
      uniform float uTime;
      varying float vHeight;
      varying float vSlope;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      float waveHeight(vec2 p) {
        float swell = sin(dot(p, normalize(vec2(1.0, .22))) * .34 + uTime * .42) * .34;
        float crossing = sin(dot(p, normalize(vec2(-.38, 1.0))) * .58 - uTime * .32) * .19;
        float rolling = sin(dot(p, normalize(vec2(.72, .69))) * 1.08 + uTime * .66) * .09;
        float chop = sin(dot(p, normalize(vec2(-.86, .51))) * 2.42 - uTime * 1.03) * .032;
        float detail = sin(p.x * 3.7 + p.y * 2.1 + uTime * .88) * .014;
        return swell + crossing + rolling + chop + detail;
      }

      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += waveHeight(p.xy);
        float epsilon = .07;
        float slopeX = (waveHeight(p.xy + vec2(epsilon, 0.0)) - waveHeight(p.xy - vec2(epsilon, 0.0))) / (2.0 * epsilon);
        float slopeY = (waveHeight(p.xy + vec2(0.0, epsilon)) - waveHeight(p.xy - vec2(0.0, epsilon))) / (2.0 * epsilon);
        vHeight = p.z;
        vSlope = length(vec2(slopeX, slopeY));
        vWorldNormal = normalize(mat3(modelMatrix) * normalize(vec3(-slopeX, -slopeY, 1.0)));
        vWorldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uEnergy;
      uniform float uHero;
      varying float vHeight;
      varying float vSlope;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
      }

      void main() {
        vec3 normal = normalize(vWorldNormal);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        vec3 moonDirection = normalize(vec3(.42, .82, -.38));
        float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.4);
        float diffuse = max(dot(normal, moonDirection), 0.0);
        float specular = pow(max(dot(reflect(-moonDirection, normal), viewDirection), 0.0), 118.0);
        float horizon = smoothstep(.02, .95, vUv.y);
        float depth = smoothstep(-.36, .38, vHeight);
        float foamNoise = noise(vWorldPosition.xz * 1.8 + vec2(uTime * .11, -uTime * .07));
        float foam = smoothstep(.42, .67, vHeight + vSlope * .28 + foamNoise * .14);
        float moonPathBase = max(0.0, 1.0 - abs(vWorldPosition.x - 5.5) / (2.4 + vUv.y * 5.0));
        float moonPath = moonPathBase * moonPathBase * smoothstep(.2, 1.0, vUv.y);
        float glint = pow(max(0.0, sin(vWorldPosition.x * 7.2 - vWorldPosition.z * 5.4 + uTime * .45)), 18.0) * moonPath;
        vec3 abyss = vec3(.002, .018, .036);
        vec3 deep = vec3(.004, .075, .105);
        vec3 surface = vec3(.018, .22, .25);
        vec3 reflectedSky = vec3(.08, .4, .43);
        vec3 color = mix(abyss, deep, horizon * .7 + depth * .18);
        color = mix(color, surface, diffuse * .34 + vSlope * .09);
        color = mix(color, reflectedSky, fresnel * (.48 + uHero * .1));
        color += vec3(.64, .95, 1.0) * specular * (1.6 + uEnergy * .55);
        color += vec3(.5, .96, .9) * foam * (.13 + uEnergy * .055);
        color += vec3(.58, .9, 1.0) * glint * .16;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  })
}

function createStars(count: number): THREE.Points {
  const random = seededRandom(4187)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - .5) * 58
    positions[index * 3 + 1] = 2.5 + random() * 17
    positions[index * 3 + 2] = -25 + random() * 31
    const brightness = .58 + random() * .42
    colors[index * 3] = brightness * .76
    colors[index * 3 + 1] = brightness * .98
    colors[index * 3 + 2] = brightness
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    size: .045,
    sizeAttenuation: true,
    vertexColors: true,
    opacity: .82,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }))
}

function createSeaSparkles(count: number, texture: THREE.Texture): THREE.Points {
  const random = seededRandom(9017)
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - .5) * 32
    positions[index * 3 + 1] = -1 + random() * .5
    positions[index * 3 + 2] = -12 + random() * 18
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    map: texture,
    color: 0x7cfff2,
    size: .075,
    sizeAttenuation: true,
    opacity: .32,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }))
}

function createMoon(texture: THREE.Texture): THREE.Group {
  const group = new THREE.Group()
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0x8edbdc, transparent: true, opacity: .28, depthWrite: false, blending: THREE.AdditiveBlending }))
  glow.scale.set(5.8, 5.8, 1)
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0xdffefb, transparent: true, opacity: .78, depthWrite: false }))
  core.scale.set(1.05, 1.05, 1)
  group.add(glow, core)
  return group
}

function createMist(texture: THREE.Texture, hero: boolean): THREE.Group {
  const group = new THREE.Group()
  const random = seededRandom(7741)
  const count = hero ? 15 : 9
  for (let index = 0; index < count; index += 1) {
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      color: index % 3 === 0 ? 0x2a6f76 : 0x173f4b,
      transparent: true,
      opacity: .055 + random() * .055,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }))
    cloud.position.set((random() - .5) * 31, .2 + random() * 2.6, -11 - random() * 8)
    cloud.scale.set(5 + random() * 8, .65 + random() * 1.2, 1)
    group.add(cloud)
  }
  return group
}

function createSoftTexture(): THREE.CanvasTexture {
  const surface = document.createElement('canvas')
  surface.width = 128
  surface.height = 128
  const context = surface.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(.2, 'rgba(255,255,255,.72)')
    gradient.addColorStop(.58, 'rgba(255,255,255,.14)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 128, 128)
  }
  const texture = new THREE.CanvasTexture(surface)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function createBoat(scale: number): THREE.Group {
  const boat = new THREE.Group()
  boat.scale.setScalar(scale)
  const hullMaterial = new THREE.MeshPhysicalMaterial({ color: 0x17636c, roughness: .3, metalness: .08, clearcoat: .9, clearcoatRoughness: .18, emissive: 0x0b3940, emissiveIntensity: .46 })
  const deckMaterial = new THREE.MeshStandardMaterial({ color: 0x8c7256, roughness: .72, metalness: .02 })
  const sailMaterial = new THREE.MeshBasicMaterial({ color: 0xd6e5df, side: THREE.DoubleSide, transparent: true, opacity: .9 })
  const mastMaterial = new THREE.MeshStandardMaterial({ color: 0x9d7953, metalness: .05, roughness: .72 })
  const riggingMaterial = new THREE.LineBasicMaterial({ color: 0xb8d4cd, transparent: true, opacity: .58 })
  const hull = new THREE.Mesh(createHullGeometry(), hullMaterial)
  hull.position.y = .02
  hull.userData.boatSurface = true
  boat.add(hull)
  const deck = new THREE.Mesh(createDeckGeometry(), deckMaterial)
  deck.position.y = .14
  deck.userData.boatSurface = true
  boat.add(deck)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(.38, .17, .38), deckMaterial)
  cabin.position.set(0, .24, -.45)
  cabin.userData.boatSurface = true
  boat.add(cabin)
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.018, .03, 1.82, 10), mastMaterial)
  mast.position.set(0, 1.04, .08)
  mast.userData.boatSurface = true
  boat.add(mast)
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(.014, .018, .92, 8), mastMaterial)
  boom.position.set(.4, .72, .08)
  boom.rotation.z = Math.PI / 2
  boom.userData.boatSurface = true
  boat.add(boom)
  boat.add(
    createBillowedSail(1, 1.03, 1.38, .36, .085, sailMaterial),
    createBillowedSail(-1, .78, 1.16, .43, .045, sailMaterial),
    createRiggingLine([[0, 1.93, .08], [1.03, .45, .085]], riggingMaterial),
    createRiggingLine([[0, 1.93, .08], [-.78, .47, .045]], riggingMaterial),
    createRiggingLine([[0, 1.93, .08], [0, .13, 1.48]], riggingMaterial),
  )
  const lantern = new THREE.Mesh(
    new THREE.SphereGeometry(.052, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe8a3 }),
  )
  lantern.position.set(.22, .39, -.42)
  boat.add(lantern)
  const wakeMaterial = new THREE.LineBasicMaterial({ color: 0xa9fff8, transparent: true, opacity: .22, blending: THREE.AdditiveBlending })
  boat.add(createWakeTrail(-.23, wakeMaterial), createWakeTrail(.23, wakeMaterial))
  return boat
}

function createHullGeometry(widthSegments = 28, heightSegments = 14): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(.72, widthSegments, heightSegments, 0, Math.PI * 2, 0, Math.PI * .57)
  geometry.scale(.72, .48, 1.72)
  geometry.rotateZ(Math.PI)
  return geometry
}

function createDeckGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.37, 0, -1, .37, 0, -1, -.56, 0, -.1, .56, 0, -.1, -.48, 0, .7, .48, 0, .7, 0, 0, 1.42,
  ], 3))
  geometry.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6])
  geometry.computeVertexNormals()
  return geometry
}

function createBillowedSail(
  side: -1 | 1,
  width: number,
  height: number,
  bottom: number,
  depth: number,
  material: THREE.Material,
): THREE.Mesh {
  const sail = new THREE.Mesh(createBillowedSailGeometry(side, width, height, bottom, depth), material)
  sail.userData.boatSurface = true
  return sail
}

function createBillowedSailGeometry(
  side: -1 | 1,
  width: number,
  height: number,
  bottom: number,
  depth: number,
): THREE.BufferGeometry {
  const segments = 7
  const positions: number[] = []
  const indices: number[] = []
  const rows: number[][] = []
  for (let mastWeight = 0; mastWeight <= segments; mastWeight += 1) {
    const row: number[] = []
    for (let outerWeight = 0; outerWeight <= segments - mastWeight; outerWeight += 1) {
      const top = mastWeight / segments
      const outer = outerWeight / segments
      const base = 1 - top - outer
      const x = side * width * outer
      const y = bottom * base + (bottom + height) * top + (bottom + .08) * outer
      const z = depth + 2.9 * base * top * outer
      row.push(positions.length / 3)
      positions.push(x, y, z)
    }
    rows.push(row)
  }
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments - row; column += 1) {
      const a = rows[row]![column]!
      const b = rows[row + 1]![column]!
      const c = rows[row]![column + 1]!
      indices.push(a, b, c)
      if (column < segments - row - 1) indices.push(b, rows[row + 1]![column + 1]!, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createFleetBoatInstances(count: number): THREE.InstancedMesh {
  const geometries = [
    createHullGeometry(16, 8).translate(0, .02, 0),
    createDeckGeometry().translate(0, .14, 0),
    new THREE.BoxGeometry(.38, .17, .38).translate(0, .24, -.45),
    new THREE.CylinderGeometry(.025, .035, 1.82, 6).translate(0, 1.04, .08),
    new THREE.CylinderGeometry(.018, .022, .92, 6).rotateZ(Math.PI / 2).translate(.4, .72, .08),
    createBillowedSailGeometry(1, 1.03, 1.38, .36, .085),
    createBillowedSailGeometry(-1, .78, 1.16, .43, .045),
    new THREE.SphereGeometry(.052, 8, 6).translate(.22, .39, -.42),
  ]
  for (const geometry of geometries) {
    for (const attribute of Object.keys(geometry.attributes)) {
      if (attribute !== 'position' && attribute !== 'normal') geometry.deleteAttribute(attribute)
    }
  }
  const geometry = mergeGeometries(geometries, false)
  geometries.forEach((source) => source.dispose())
  if (!geometry) throw new Error('Could not merge fleet boat geometry')
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x082a30,
    emissiveIntensity: .38,
    metalness: .06,
    roughness: .5,
    side: THREE.DoubleSide,
  })
  const instances = new THREE.InstancedMesh(geometry, material, count)
  instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  instances.frustumCulled = false
  return instances
}

function createRiggingLine(points: Array<[number, number, number]>, material: THREE.LineBasicMaterial): THREE.Line {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z))),
    material,
  )
}

function createWakeTrail(side: number, material: THREE.LineBasicMaterial): THREE.Line {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(side, -.17, -.68),
    new THREE.Vector3(side * 1.55, -.2, -1.35),
    new THREE.Vector3(side * 2.25, -.22, -2.05),
  )
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(18)), material)
}

function createDestinationPin(): THREE.Group {
  const pin = new THREE.Group()
  const markerMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9fff8,
    emissive: 0x72fff2,
    emissiveIntensity: 1.35,
    metalness: .16,
    roughness: .28,
  })
  markerMaterial.name = 'destination-marker'
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x16343a, metalness: .68, roughness: .3 })

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.022, .036, .7, 10), darkMetal)
  stem.position.y = .2
  const point = new THREE.Mesh(new THREE.ConeGeometry(.105, .36, 16), markerMaterial)
  point.position.y = .63
  point.rotation.z = Math.PI
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.19, 20, 14), markerMaterial)
  beacon.position.y = .88
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(.28, .025, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0x72fff2, transparent: true, opacity: .72, blending: THREE.AdditiveBlending }),
  )
  halo.name = 'destination-halo'
  halo.position.y = .88
  const waterRing = new THREE.Mesh(
    new THREE.TorusGeometry(.3, .018, 6, 32),
    new THREE.MeshBasicMaterial({ color: 0x72fff2, transparent: true, opacity: .26, blending: THREE.AdditiveBlending }),
  )
  waterRing.name = 'destination-halo'
  waterRing.position.y = -.16
  waterRing.rotation.x = Math.PI / 2
  pin.add(stem, point, beacon, halo, waterRing)
  return pin
}

function setDestinationPinColor(pin: THREE.Group, color: number) {
  pin.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (object.material.name === 'destination-marker') {
      const material = object.material as THREE.MeshStandardMaterial
      material.color.setHex(color)
      material.emissive.setHex(color)
    } else if (object.name === 'destination-halo') {
      ;(object.material as THREE.MeshBasicMaterial).color.setHex(color)
    }
  })
}

function createHarborDock(): THREE.Group {
  const dock = new THREE.Group()
  dock.position.set(-1.08, 0, 0)
  const woodColors = [0x6f4629, 0x805334, 0x5d3924]
  const woodMaterials = woodColors.map((color) => new THREE.MeshStandardMaterial({
    color,
    roughness: .86,
    metalness: .02,
  }))
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: .94 })
  const brass = new THREE.MeshStandardMaterial({ color: 0xa97739, emissive: 0x4b2a0d, emissiveIntensity: .3, metalness: .48, roughness: .38 })
  const lanternMaterial = new THREE.MeshBasicMaterial({ color: 0xffd68a })

  for (let index = 0; index < 9; index += 1) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.35, .13, .34), woodMaterials[index % woodMaterials.length])
    plank.position.set(0, -.39 + (index % 3) * .006, 5.65 + index * .37)
    plank.rotation.y = (index % 2 ? 1 : -1) * .008
    dock.add(plank)
  }

  const underRailLeft = new THREE.Mesh(new THREE.BoxGeometry(.14, .15, 3.45), darkWood)
  underRailLeft.position.set(-.5, -.5, 7.13)
  const underRailRight = underRailLeft.clone()
  underRailRight.position.x = .5
  dock.add(underRailLeft, underRailRight)

  for (const z of [5.62, 7.02, 8.58]) {
    for (const x of [-.78, .78]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.075, .095, 1.15, 10), darkWood)
      post.position.set(x, -.33, z)
      dock.add(post)
    }
  }

  for (const x of [-.58, .58]) {
    const lanternPost = new THREE.Mesh(new THREE.CylinderGeometry(.025, .035, .66, 10), brass)
    lanternPost.position.set(x, -.03, 5.74)
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(.075, 12, 8), lanternMaterial)
    lantern.position.set(x, .31, 5.74)
    dock.add(lanternPost, lantern)
  }
  const harborLight = new THREE.PointLight(0xffbd69, 8, 4.2, 2)
  harborLight.position.set(0, .35, 5.7)
  dock.add(harborLight)

  const ropeMaterial = new THREE.LineBasicMaterial({ color: 0xb28a5b, transparent: true, opacity: .62 })
  const mooringRope = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(.73, -.05, 5.72),
    new THREE.Vector3(1.02, -.38, 5.9),
    new THREE.Vector3(1.14, -.27, 6.25),
  )
  dock.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(mooringRope.getPoints(18)), ropeMaterial))
  return dock
}

function setBoatColor(boat: THREE.Group, color: number) {
  boat.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData.boatSurface) return
    const material = object.material as THREE.MeshStandardMaterial
    if (material.emissive) material.emissive.setHex(color)
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
