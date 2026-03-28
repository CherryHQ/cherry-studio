/**
 * @license
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 konpa
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import BashIcon from '@renderer/assets/images/lang/bash.svg'
import CIcon from '@renderer/assets/images/lang/c.svg'
import CMakeIcon from '@renderer/assets/images/lang/cmake.svg'
import CppIcon from '@renderer/assets/images/lang/cplusplus.svg'
import CSharpIcon from '@renderer/assets/images/lang/csharp.svg'
import CSS3Icon from '@renderer/assets/images/lang/css3.svg'
import GoIcon from '@renderer/assets/images/lang/go.svg'
import JavaIcon from '@renderer/assets/images/lang/java.svg'
import JavaScriptIcon from '@renderer/assets/images/lang/javascript.svg'
import JsonIcon from '@renderer/assets/images/lang/json.svg'
import LuaIcon from '@renderer/assets/images/lang/lua.svg'
import PerlIcon from '@renderer/assets/images/lang/perl.svg'
import PhpIcon from '@renderer/assets/images/lang/php.svg'
import PythonIcon from '@renderer/assets/images/lang/python.svg'
import RubyIcon from '@renderer/assets/images/lang/ruby.svg'
import RustIcon from '@renderer/assets/images/lang/rust.svg'
import TypeScriptIcon from '@renderer/assets/images/lang/typescript.svg'
import VBIcon from '@renderer/assets/images/lang/vb.svg'
import XMLIcon from '@renderer/assets/images/lang/xml.svg'
import YamlIcon from '@renderer/assets/images/lang/yaml.svg'
export function getLangLogo(lang: string) {
  if (!lang) {
    return undefined
  }

  const logoMap = {
    bash: BashIcon,
    cpp: CppIcon,
    cmake: CMakeIcon,
    css: CSS3Icon,
    css3: CSS3Icon,
    '^c$': CIcon,
    '^cs$': CSharpIcon,
    csharp: CSharpIcon,
    go: GoIcon,
    lua: LuaIcon,
    js: JavaScriptIcon,
    javascript: JavaScriptIcon,
    java: JavaIcon,
    json: JsonIcon,
    python: PythonIcon,
    py: PythonIcon,
    perl: PerlIcon,
    php: PhpIcon,
    rs: RustIcon,
    rust: RustIcon,
    ts: TypeScriptIcon,
    typescript: TypeScriptIcon,
    yml: YamlIcon,
    yaml: YamlIcon,
    ruby: RubyIcon,
    vb: VBIcon,
    visualbasic: VBIcon,
    xml: XMLIcon
  }

  for (const key in logoMap) {
    const regex = new RegExp(key, 'i')
    if (regex.test(lang)) {
      return logoMap[key]
    }
  }

  return undefined
}
