import typescript from 'rollup-plugin-typescript';
import {
    terser
} from 'rollup-plugin-terser';
import pkg from './package.json';

function toMinPath(path) {
    return path.replace(/\.js$/, '.min.js');
}

export default [
    {
        input: './src/core/index.ts',
        plugins: [typescript()],
        output: [{
            name: 'ArkadPlayer',
            format: 'es',
            file: pkg.main,
        }, ],
    },
    // {
    //     input: '../recorder/src/index.ts',
    //     plugins: [typescript(), terser()],
    //     output: [{
    //         name: 'ArkadRecorder',
    //         format: 'es',
    //         file: pkg.main,
    //         file: toMinPath(pkg.main),
    //         sourcemap: true,
    //     }, ],
    // },
    // {
    //     input: './src/core/index.ts',
    //     plugins: [typescript(), terser()],
    //     output: [{
    //         name: 'ArkadPlayer',
    //         format: 'es',
    //         file: toMinPath(pkg.main),
    //         sourcemap: true,
    //     }, ],
    // },
];