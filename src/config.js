// config.js — every tunable value lives here.
// Reference units: Rocket League "uu" (game units). 100 uu = 1 m.
// All simulation code works in METRES / seconds; use uu() to convert on the way in.
export const UU = 0.01;
export const uu = (v) => v * UU;
export const toUU = (m) => m / UU;

export const CFG = {
  version: '1.0.0',

  // ---------------------------------------------------------------- simulation
  sim: {
    hz: 120,
    maxCatchupSteps: 8,           // bounded accumulator
    gravity: uu(650),             // m/s^2 (applies to cars and ball)
    solverIterations: 10,
  },

  // ---------------------------------------------------------------- arena
  arena: {
    halfWidth: uu(4096),
    halfLength: uu(5120),
    height: uu(2044),
    floorRampRadius: uu(260),     // floor -> wall curve
    ceilingRampRadius: uu(260),   // wall -> ceiling curve
    cornerRadius: uu(1152),       // vertical (plan view) corner radius
    goalHalfWidth: uu(892.75),    // 1785.5 / 2
    goalHeight: uu(642.775),
    goalDepth: uu(880),
    postRadius: uu(30),
    arcSegments: 14,              // tessellation of curved parts
    friction: 0.5,
    restitution: 0.75,
  },

  // ---------------------------------------------------------------- car (Octane)
  car: {
    // hitbox 120.5 x 86.7 x 38.7 uu  (length x width x height)
    halfLength: uu(120.5) / 2,
    halfWidth: uu(86.7) / 2,
    halfHeight: uu(38.7) / 2,
    mass: 180,
    comOffsetY: -0.04,            // centre of mass slightly below the hitbox centre
    restHeight: 0.205,            // hitbox centre height above ground at rest
    wheelRadius: 0.14,
    wheelbase: uu(101.5),         // used for the steering model reference
    // wheel hub attach points in hitbox-local space (x = right, z = back)
    wheelX: 0.40,
    wheelZFront: -0.43,
    wheelZRear: 0.38,
    wheelAttachY: -0.02,
    suspensionDroop: 0.05,        // extra ray length beyond the spring free length
    springEquilibrium: 0.07,
    springDampingRatio: 0.55,
    bumpStopStart: 0.10,
    bumpStopStiffness: 9,
    rollInfluence: 0.06,
    lateralGrip: 1.0,             // fraction of lateral slip cancelled per step
    frictionCoeff: 4.0,           // tyre friction circle (mu)
    powerslideGrip: 0.10,         // grip multiplier under powerslide
    powerslideYawRate: 4.2,       // rad/s at full steer
    powerslideYawAccel: 22,       // rad/s^2
    gripRecoveryTime: 0.18,       // s to restore grip after releasing handbrake
    stickyAccel: uu(325),         // pushes the car into the surface while wheels touch
    throttleAccel0: uu(1600),
    maxDriveSpeed: uu(1410),
    brakeAccel: uu(3500),
    coastAccel: uu(525),
    reverseMaxSpeed: uu(1410),
    boostAccelGround: uu(992),
    boostAccelAir: uu(1058),
    maxSpeed: uu(2300),
    supersonic: uu(2200),
    airThrottleAccel: uu(66.7),
    steerAngles: [ // [speed uu/s, degrees]
      [0, 35], [500, 20], [1000, 11], [1500, 6.25], [1750, 5], [3000, 2],
    ],
    // jumping
    jumpImpulse: uu(292),
    jumpHoldAccel: uu(1458),
    jumpHoldTime: 0.2,
    dodgeWindow: 1.25,            // after the first jump
    fallOffJumpWindow: 1.45,      // when driving off an edge without jumping
    dodgeImpulse: uu(500),
    dodgeSpeedBonus: 0.9,
    dodgeDeadzone: 0.5,
    flipTime: 0.65,               // one full, clean revolution in this time
    flipRampIn: 0.12,             // fraction of flipTime spent spinning up
    flipRampOut: 0.3,             // fraction spent easing out so the car comes out level
    flipAngleGain: 10,            // closed-loop correction toward the scheduled angle (1/s)
    flipOffAxisDamp: 12,          // damping of stray pitch/roll spin during a flip (1/s)
    flipMaxAngularSpeed: 14,      // rad/s ceiling while the dodge rotation runs
    flipVerticalDamp: 0.35,
    flipVerticalDampTime: 0.15,
    flipCancelThreshold: 0.5,
    // air control (rad/s^2 and damping coefficients, local frame)
    airPitchAccel: 12.46, airYawAccel: 9.11, airRollAccel: 38.34,
    airPitchDamp: 2.798, airYawDamp: 1.886, airRollDamp: 4.0,
    maxAngularSpeed: 5.5,
    // damage
    demoRespawn: 3.0,
    demoMinRelSpeed: uu(300),
    // boost
    boostStart: 33.33,
    boostMax: 100,
    boostPerSecond: 33.3,
    // friction of chassis collider vs world
    colliderFriction: 0.4,
    colliderRestitution: 0.15,
  },

  // ---------------------------------------------------------------- ball
  ball: {
    radius: uu(91.25),
    mass: 30,
    maxSpeed: uu(6000),
    maxAngularSpeed: 6,
    linearDamping: 0.03,
    angularDamping: 0.05,
    restitution: 0.8,             // x arena 0.75 = 0.6 combined
    friction: 0.7,                // x arena 0.5 = 0.35 combined
    carRestitution: 0.35,
    // car-ball extra impulse (Rocket-League style hit model)
    hitVerticalScale: 0.35,
    hitCurve: [[0, 0.65], [500, 0.65], [2300, 0.55], [4600, 0.30]], // [relative speed uu/s, factor]
    hitCooldown: 0.05,
  },

  // ---------------------------------------------------------------- boost pads
  boost: {
    smallAmount: 12, smallRespawn: 4, smallRadius: uu(144),
    largeAmount: 100, largeRespawn: 10, largeRadius: uu(208),
    pickupHeight: uu(165),
  },

  // ---------------------------------------------------------------- camera
  camera: {
    hFov: 110,
    distance: 270,
    height: 100,
    angle: -4,                    // degrees (pitch of the view)
    stiffness: 0.4,
    swivelSpeed: 4.0,
    transitionSpeed: 6.0,
    ballCamPitchMax: 45,
    freeLookMax: 1.9,
  },

  // ---------------------------------------------------------------- match
  match: {
    duration: 300,
    countdown: 3,
    goalCelebration: 2.2,
    replayDuration: 5.0,
    replaySpeed: 0.5,
    resultsDelay: 1.0,
    kickoffHalfWidth: 0,
  },

  // ---------------------------------------------------------------- input
  input: {
    stickDeadzone: 0.12,
    triggerDeadzone: 0.05,
    steerSensitivity: 1.0,
    dodgeDeadzone: 0.5,
    mouseSensitivity: 0.0022,
    bindings: {
      throttle: ['KeyW'], brake: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
      jump: ['Space'], boost: ['ShiftLeft', 'ShiftRight'],
      powerslide: ['ControlLeft', 'ControlRight'],
      rollLeft: ['KeyQ'], rollRight: ['KeyE'],
      ballCam: ['KeyC'], reset: ['KeyR'],
      lookLeft: ['ArrowLeft'], lookRight: ['ArrowRight'], lookUp: ['ArrowUp'], lookDown: ['ArrowDown'],
      pause: ['Escape'],
    },
  },

  // ---------------------------------------------------------------- AI
  ai: {
    difficulties: {
      rookie: { reaction: 0.28, steerNoise: 0.18, boostUse: 0.5, aerial: false, dodge: false, predictTime: 2.0, speedLimit: 0.8, powerslide: false },
      pro:    { reaction: 0.14, steerNoise: 0.07, boostUse: 0.8, aerial: false, dodge: true,  predictTime: 3.0, speedLimit: 1.0, powerslide: true },
      allstar:{ reaction: 0.05, steerNoise: 0.02, boostUse: 1.0, aerial: true,  dodge: true,  predictTime: 4.0, speedLimit: 1.0, powerslide: true },
    },
  },

  // ---------------------------------------------------------------- audio/ui
  audio: { master: 0.6, mute: false },
  ui: { showFps: false },
};

export function lerpTable(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return table[table.length - 1][1];
}
