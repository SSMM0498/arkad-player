import json from '@rollup/plugin-json';
import commonjs from "@rollup/plugin-commonjs";
import typescript from 'rollup-plugin-typescript';
import resolve from '@rollup/plugin-node-resolve'
import pkg from './package.json';

function toMinPath(path) {
    return path.replace(/\.js$/, '.min.js');
}

export default [{
    input: './src/core/index.ts',
    plugins: [
        json(),
        typescript(),
        resolve(),
        commonjs()
    ],
    output: [{
        name: 'ArkadPlayer',
        format: 'es',
        file: pkg.main,
    }, ],
}];