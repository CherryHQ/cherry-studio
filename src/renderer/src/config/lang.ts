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
import PhpIcon from '@renderer/assets/images/lang/php.svg'
import PythonIcon from '@renderer/assets/images/lang/python.svg'
import RubyIcon from '@renderer/assets/images/lang/ruby.svg'
import RustIcon from '@renderer/assets/images/lang/rust.svg'
import TypeScriptIcon from '@renderer/assets/images/lang/typescript.svg'
import VBIcon from '@renderer/assets/images/lang/vb.svg'
import XMLIcon from '@renderer/assets/images/lang/xml.svg'
import YamlIcon from '@renderer/assets/images/lang/yaml.svg'
export function getLangLogo(lang: string) {
  const isLight = true

  if (!lang) {
    return undefined
  }

  const logoMap = {
    TS: isLight ? TypeScriptIcon : TypeScriptIcon,
    TypeScript: isLight ? TypeScriptIcon : TypeScriptIcon,
    JS: isLight ? JavaScriptIcon : JavaScriptIcon,
    JavaScript: isLight ? JavaScriptIcon : JavaScriptIcon,
    Python: isLight ? PythonIcon : PythonIcon,
    PY: isLight ? PythonIcon : PythonIcon,
    Java: isLight ? JavaIcon : JavaIcon,
    CPP: isLight ? CppIcon : CppIcon,
    CMake: isLight ? CMakeIcon : CMakeIcon,
    '^c$': isLight ? CIcon : CIcon,
    csharp: isLight ? CSharpIcon : CSharpIcon,
    Go: isLight ? GoIcon : GoIcon,
    Json: isLight ? JsonIcon : JsonIcon,
    Rust: isLight ? RustIcon : RustIcon,
    Yaml: isLight ? YamlIcon : YamlIcon,
    Php: isLight ? PhpIcon : PhpIcon,
    Ruby: isLight ? RubyIcon : RubyIcon,
    Lua: isLight ? LuaIcon : LuaIcon,
    CSS: isLight ? CSS3Icon : CSS3Icon,
    CSS3: isLight ? CSS3Icon : CSS3Icon,
    XML: isLight ? XMLIcon : XMLIcon,
    vb: isLight ? VBIcon : VBIcon,
    visualbasic: isLight ? VBIcon : VBIcon,
    HTML: isLight ? XMLIcon : XMLIcon
  }

  for (const key in logoMap) {
    const regex = new RegExp(key, 'i')
    if (regex.test(lang)) {
      return logoMap[key]
    }
  }

  return undefined
}
