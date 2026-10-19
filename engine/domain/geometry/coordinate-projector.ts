import { cos, rotate, rotateX, rotateY, roundZero, sin } from './rotation';
interface Point {
    x: number;
    y: number;
}
interface Dimensions {
    width: number;
    height: number;
}
interface Rectangle extends Point, Dimensions {
}
interface RotatableRectangle extends Rectangle {
    rotation: number;
}
export function projectRectToRotatedPage(rect: RotatableRectangle, page: Dimensions, pageRotation: number): Rectangle {
    const selfRotatedRectCorners = [
        { x: 0, y: 0 },
        { x: rect.width, y: 0 },
        { x: rect.width, y: rect.height },
        { x: 0, y: rect.height },
    ]
        .map(corner => rotate(corner, rect.rotation))
        .map(corner => ({
        x: corner.x + rect.x,
        y: corner.y + rect.y,
    }));
    const originalPageCenter: Point = {
        x: page.width / 2,
        y: page.height / 2,
    };
    const rotatedPageDimensions = getRotatedDimensions(page, pageRotation);
    const rotatedPageCenter: Point = {
        x: rotatedPageDimensions.width / 2,
        y: rotatedPageDimensions.height / 2,
    };
    const pageRotatedRectCorners = selfRotatedRectCorners.map(corner => {
        const centeredCorner: Point = {
            x: corner.x - originalPageCenter.x,
            y: corner.y - originalPageCenter.y,
        };
        const rotatedCorner = rotate(centeredCorner, pageRotation);
        return {
            x: rotatedCorner.x + rotatedPageCenter.x,
            y: rotatedCorner.y + rotatedPageCenter.y,
        };
    });
    return getBoundingBoxFromCorners(pageRotatedRectCorners);
}
export function projectRectToOriginalPage(rect: RotatableRectangle, page: Dimensions, pageRotation: number): Rectangle {
    const pageRotatedRectCorners: Point[] = [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
        { x: rect.x, y: rect.y + rect.height },
    ];
    const originalPageCenter: Point = {
        x: page.width / 2,
        y: page.height / 2,
    };
    const rotatedPageDimensions = getRotatedDimensions(page, pageRotation);
    const rotatedPageCenter: Point = {
        x: rotatedPageDimensions.width / 2,
        y: rotatedPageDimensions.height / 2,
    };
    const selfRotatedRectCorners = pageRotatedRectCorners.map(corner => {
        const centeredCorner: Point = {
            x: corner.x - rotatedPageCenter.x,
            y: corner.y - rotatedPageCenter.y,
        };
        const unrotatedCorner = rotate(centeredCorner, -pageRotation);
        return {
            x: unrotatedCorner.x + originalPageCenter.x,
            y: unrotatedCorner.y + originalPageCenter.y,
        };
    });
    const selfRotatedRect = getBoundingBoxFromCorners(selfRotatedRectCorners);
    return getOriginalRectFromSelfRotated(selfRotatedRect, rect.rotation);
}
export function getRotatedDimensions(dimensions: Dimensions, rotationAngle: number): Dimensions {
    return {
        width: Math.abs(rotateX(dimensions.width, dimensions.height, rotationAngle)),
        height: Math.abs(rotateY(dimensions.width, dimensions.height, rotationAngle)),
    };
}
function getOriginalRectFromSelfRotated(rect: Rectangle, rotation: number): Rectangle {
    const cosValue = roundZero(cos(rotation), 1e-10);
    const sinValue = roundZero(sin(rotation), 1e-10);
    const x = rect.x + rect.width * ((1 - cosValue + sinValue) / 2);
    const y = rect.y + rect.height * ((1 - cosValue - sinValue) / 2);
    const { width, height } = getRotatedDimensions(rect, -rotation);
    return { x, y, width, height };
}
function getBoundingBoxFromCorners(corners: Point[]): Rectangle {
    if (corners.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
    let minX = corners[0].x;
    let maxX = corners[0].x;
    let minY = corners[0].y;
    let maxY = corners[0].y;
    for (let i = 1; i < corners.length; i++) {
        const corner = corners[i];
        minX = Math.min(minX, corner.x);
        maxX = Math.max(maxX, corner.x);
        minY = Math.min(minY, corner.y);
        maxY = Math.max(maxY, corner.y);
    }
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}
