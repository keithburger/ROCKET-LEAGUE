// physics.js — Rapier world wrapper: world creation, arena collider, bodies, queries.
import RAPIER from '../vendor/rapier.es.js';
import { CFG } from './config.js';

export const GROUP = { ARENA: 0x1, CAR: 0x2, BALL: 0x4 };
const groups = (member, filter) => ((member << 16) | filter) >>> 0;

export class Physics {
  static async create(arenaGeo) {
    await RAPIER.init();
    return new Physics(arenaGeo);
  }

  constructor(arenaGeo) {
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -CFG.sim.gravity, z: 0 });
    this.world.timestep = 1 / CFG.sim.hz;
    this.world.numSolverIterations = CFG.sim.solverIterations;
    this.events = new RAPIER.EventQueue(true);
    this.rayArena = groups(GROUP.ARENA | GROUP.CAR | GROUP.BALL, GROUP.ARENA);
    this.buildArena(arenaGeo);
  }

  buildArena(geo) {
    const R = RAPIER, a = CFG.arena;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    const desc = R.ColliderDesc.trimesh(geo.collider.positions, geo.collider.indices)
      .setFriction(a.friction).setRestitution(a.restitution)
      .setFrictionCombineRule(R.CoefficientCombineRule.Multiply)
      .setRestitutionCombineRule(R.CoefficientCombineRule.Multiply)
      .setCollisionGroups(groups(GROUP.ARENA, GROUP.CAR | GROUP.BALL));
    this.arenaCollider = this.world.createCollider(desc, body);
    // goal frame
    for (const f of geo.frame) {
      let d;
      if (f.kind === 'post') d = R.ColliderDesc.cylinder(f.halfHeight, f.radius).setTranslation(f.x, f.y, f.z);
      else {
        d = R.ColliderDesc.cylinder(f.halfLength, f.radius).setTranslation(f.x, f.y, f.z)
          .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }); // cylinder axis Y -> X
      }
      d.setFriction(a.friction).setRestitution(a.restitution)
        .setFrictionCombineRule(R.CoefficientCombineRule.Multiply)
        .setRestitutionCombineRule(R.CoefficientCombineRule.Multiply)
        .setCollisionGroups(groups(GROUP.ARENA, GROUP.CAR | GROUP.BALL));
      this.world.createCollider(d, body);
    }
  }

  createBall(x, y, z) {
    const R = RAPIER, b = CFG.ball;
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z)
      .setLinearDamping(b.linearDamping).setAngularDamping(b.angularDamping).setCcdEnabled(true));
    const col = this.world.createCollider(R.ColliderDesc.ball(b.radius).setMass(b.mass)
      .setRestitution(b.restitution).setFriction(b.friction)
      .setFrictionCombineRule(R.CoefficientCombineRule.Multiply)
      .setRestitutionCombineRule(R.CoefficientCombineRule.Multiply)
      .setCollisionGroups(groups(GROUP.BALL, GROUP.ARENA | GROUP.CAR)), body);
    return { body, collider: col };
  }

  createChassis(x, y, z, yaw) {
    const R = RAPIER, c = CFG.car;
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(q)
      .setLinearDamping(0).setAngularDamping(0).setCcdEnabled(true)
      .setAdditionalMassProperties(c.mass, { x: 0, y: c.comOffsetY, z: 0 }, this.carInertia(), { x: 0, y: 0, z: 0, w: 1 }));
    const col = this.world.createCollider(R.ColliderDesc.cuboid(c.halfWidth, c.halfHeight, c.halfLength).setDensity(0)
      .setFriction(c.colliderFriction).setRestitution(c.colliderRestitution)
      .setFrictionCombineRule(R.CoefficientCombineRule.Multiply)
      .setRestitutionCombineRule(R.CoefficientCombineRule.Min)
      .setCollisionGroups(groups(GROUP.CAR, GROUP.ARENA | GROUP.BALL | GROUP.CAR))
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), body);
    body.recomputeMassPropertiesFromColliders();
    return { body, collider: col };
  }

  // Principal inertia of the chassis (boxy, scaled up like RL's long-axis-heavy tensor).
  carInertia() {
    const c = CFG.car, m = c.mass;
    const w = c.halfWidth * 2, h = c.halfHeight * 2 * 1.6, l = c.halfLength * 2;
    return { x: (m / 12) * (h * h + l * l), y: (m / 12) * (w * w + l * l), z: (m / 12) * (w * w + h * h) };
  }

  step() { this.world.step(this.events); }

  // Ray against the static arena only. Returns {toi, nx,ny,nz} or null.
  rayArenaCast(ox, oy, oz, dx, dy, dz, maxToi) {
    const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRayAndGetNormal(ray, maxToi, true, undefined, this.rayArena);
    if (!hit) return null;
    return { toi: hit.toi, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z };
  }

  // True when the given collider currently has contact points with the arena (from the last step).
  touchesArena(collider) {
    let touch = false;
    this.world.contactPair(collider, this.arenaCollider, (m) => { if (m.numSolverContacts() > 0) touch = true; });
    return touch;
  }
}
