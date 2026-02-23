import {
    apiPath as indiumApiPath,
    assetPath as indiumAssetPath,
    routePath as indiumRoutePath
} from './indiumApi';

function trimLeadingSlash(path: string): string {
    return path.replace(/^\/+/, '');
}

export function routePath(path: string): string {
    return indiumRoutePath(path);
}

export function apiPath(path: string): string {
    return indiumApiPath(path);
}

export function assetPath(path: string): string {
    return indiumAssetPath(path);
}

export function indiumSvg(name: string): string {
    return assetPath(`assets/svg/${trimLeadingSlash(name)}`);
}

export function webAmpBrandAsset(path: string): string {
    return `/apps/webamp/assets/${trimLeadingSlash(path)}`;
}
