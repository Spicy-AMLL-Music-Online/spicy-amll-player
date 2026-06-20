/**
 * Spicy AMLL Player WEB — Cubic Spline Interpolation
 * Port of the cubic-spline npm package for smooth animation curves.
 */

export default class Spline {
  constructor(xs, ys) {
    this.xs = xs;
    this.ys = ys;
    this.ks = this._getNaturalKs(xs, ys);
  }

  _getNaturalKs(xs, ys) {
    const n = xs.length - 1;
    const matrix = [];
    const result = [];

    // Build tridiagonal matrix
    for (let i = 0; i <= n; i++) {
      matrix.push([0, 0, 0]);
      result.push(0);
    }

    // Internal points
    for (let i = 1; i < n; i++) {
      const dx1 = xs[i] - xs[i - 1];
      const dx2 = xs[i + 1] - xs[i];
      matrix[i][0] = 1 / dx1;
      matrix[i][1] = 2 * (1 / dx1 + 1 / dx2);
      matrix[i][2] = 1 / dx2;
      result[i] = 3 * ((ys[i] - ys[i - 1]) / (dx1 * dx1) + (ys[i + 1] - ys[i]) / (dx2 * dx2));
    }

    // Boundary conditions (natural spline)
    matrix[0][1] = 2 / (xs[1] - xs[0]);
    matrix[0][2] = 1 / (xs[1] - xs[0]);
    result[0] = 3 * (ys[1] - ys[0]) / ((xs[1] - xs[0]) * (xs[1] - xs[0]));

    matrix[n][0] = 1 / (xs[n] - xs[n - 1]);
    matrix[n][1] = 2 / (xs[n] - xs[n - 1]);
    result[n] = 3 * (ys[n] - ys[n - 1]) / ((xs[n] - xs[n - 1]) * (xs[n] - xs[n - 1]));

    // Solve by forward elimination
    for (let i = 1; i <= n; i++) {
      const m = matrix[i][0] / matrix[i - 1][1];
      matrix[i][1] -= m * matrix[i - 1][2];
      result[i] -= m * result[i - 1];
    }

    // Back-substitute
    const ks = new Array(n + 1);
    ks[n] = result[n] / matrix[n][1];
    for (let i = n - 1; i >= 0; i--) {
      ks[i] = (result[i] - matrix[i][2] * ks[i + 1]) / matrix[i][1];
    }

    return ks;
  }

  at(x) {
    // Clamp to range
    if (x <= this.xs[0]) return this.ys[0];
    if (x >= this.xs[this.xs.length - 1]) return this.ys[this.ys.length - 1];

    // Find segment
    let i = 0;
    for (; i < this.xs.length - 1; i++) {
      if (this.xs[i + 1] >= x) break;
    }

    const dx = this.xs[i + 1] - this.xs[i];
    const t = (x - this.xs[i]) / dx;

    const a = this.ks[i] * dx - (this.ys[i + 1] - this.ys[i]);
    const b = -this.ks[i + 1] * dx + (this.ys[i + 1] - this.ys[i]);

    return (1 - t) * this.ys[i] + t * this.ys[i + 1] + t * (1 - t) * ((1 - t) * a + t * b);
  }
}
