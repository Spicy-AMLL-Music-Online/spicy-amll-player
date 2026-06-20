/**
 * Spicy AMLL Player WEB — Analytic Spring Physics
 * Based on @spikerko/web-modules/Spring (analytic harmonic oscillator solution)
 * This is significantly more stable than Euler integration at variable frame rates.
 */

const pi = Math.PI;
const tau = pi * 2;
const exp = Math.exp;
const sin = Math.sin;
const cos = Math.cos;
const sqrt = Math.sqrt;

const EPS = 1e-5;
const SLEEP_OFFSET_SQ_LIMIT = (1 / 3840) ** 2;
const SLEEP_VELOCITY_SQ_LIMIT = 1e-2 ** 2;

export default class Spring {
  constructor(startPosition, frequency = 1, dampingRatio = 0.5, goal = startPosition) {
    if (frequency * dampingRatio < 0) {
      throw new Error("Spring will not converge");
    }

    this.dampingRatio = dampingRatio;
    this.frequency = frequency;
    this.goal = goal;
    this.position = startPosition;
    this.velocity = 0;
  }

  // Alias for legacy code compatibility
  get value() {
    return this.position;
  }

  set value(v) {
    this.position = v;
  }

  SetGoal(goal, immediate = false) {
    this.goal = goal;
    if (immediate) {
      this.position = goal;
      this.velocity = 0;
    }
  }

  Step(deltaTime) {
    if (deltaTime <= 0) return this.position;

    // Cap deltaTime to avoid instability on very long frames
    const dt = Math.min(deltaTime, 0.1);

    const d = this.dampingRatio;
    const f = this.frequency * tau; // Hz -> Rad/s
    const g = this.goal;
    const p = this.position;
    const v = this.velocity;

    if (d === 1) { // Critically damped
      const q = exp(-f * dt);
      const w = dt * q;
      const wScaledFrequency = w * f;
      const c0 = q + wScaledFrequency;
      const c2 = q - wScaledFrequency;
      const c3 = w * (f ** 2);
      const dist = p - g;

      this.position = dist * c0 + v * w + g;
      this.velocity = v * c2 - dist * c3;
    } else if (d < 1) { // Underdamped
      const fStep = f * dt;
      const q = exp(-d * fStep);
      const c = sqrt(1 - d ** 2);
      const cFStep = c * fStep;
      const cosVal = cos(cFStep);
      const sinVal = sin(cFStep);

      let z;
      if (c > EPS) {
        z = sinVal / c;
      } else {
        const c2 = c ** 2;
        z = fStep + (((fStep ** 2 * c2 * c2 / 20 - c2) * fStep ** 3) / 6);
      }

      let y;
      const cF = f * c;
      if (cF > EPS) {
        y = sinVal / cF;
      } else {
        const cF2 = cF ** 2;
        y = dt + (((dt ** 2 * cF2 * cF2 / 20 - cF2) * dt ** 3) / 6);
      }

      const dist = p - g;
      this.position = (dist * (cosVal + z * d) + v * y) * q + g;
      this.velocity = (v * (cosVal - z * d) - dist * (z * f)) * q;
    } else { // Overdamped
      const c = sqrt(d ** 2 - 1);
      const r1 = -f * (d - c);
      const r2 = -f * (d + c);
      const ec1 = exp(r1 * dt);
      const ec2 = exp(r2 * dt);
      const dist = p - g;
      const co2 = (v - dist * r1) / (2 * f * c);
      const co1 = ec1 * (dist - co2);
      const coEc2 = co2 * ec2;

      this.position = co1 + coEc2 + g;
      this.velocity = co1 * r1 + coEc2 * r2;
    }

    // Settle logic
    if (Math.abs(this.velocity) < 1e-4 && Math.abs(this.position - this.goal) < 1e-4) {
      this.position = this.goal;
      this.velocity = 0;
    }

    return this.position;
  }
}
