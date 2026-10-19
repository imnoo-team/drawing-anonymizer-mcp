export function rotate(point: {
    x: number;
    y: number;
}, rotation: number, size?: {
    width: number;
    height: number;
}) {
    return {
        x: rotateX(point.x, point.y, rotation, size?.width),
        y: rotateY(point.x, point.y, rotation, size?.height),
    };
}
export function rotateX(x: number, y: number, rotation: number, width?: number) {
    let rotatedX = x * cos(rotation) - y * sin(rotation);
    rotatedX = roundZero(rotatedX);
    return width ? (width + rotatedX) % width : rotatedX;
}
export function rotateY(x: number, y: number, rotation: number, height?: number) {
    let rotatedY = y * cos(rotation) + x * sin(rotation);
    rotatedY = roundZero(rotatedY);
    return height ? (height + rotatedY) % height : rotatedY;
}
export function roundZero(value: number, precision?: number) {
    return Math.abs(value) <= (precision ?? Number.EPSILON) ? 0 : value;
}
export function cos(rotation: number) {
    return Math.cos(toRadian(rotation));
}
export function sin(rotation: number) {
    return Math.sin(toRadian(rotation));
}
function toRadian(rotation: number) {
    return rotation * (Math.PI / 180);
}
