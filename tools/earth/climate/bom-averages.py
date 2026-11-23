#!/usr/bin/env python3
"""从澳大利亚气象局（BOM）抓逐站月平均表，打印 src/game/data/climate.ts 用的四项（核对用，不自动改代码）。

用法：python3 -I tools/earth/climate/bom-averages.py 003003 009021 ...
来源页面：https://www.bom.gov.au/climate/averages/tables/cw_<站号>.shtml
抓到的是 HTML；如果返回的不是统计表（被拦、改版），会报错退出，不要用拦截页里的数凑数。
"""
import html
import re
import sys
import urllib.request

ROWS = {
    'tmax': r'^Mean +maximum temperature',
    'tmin': r'^Mean minimum temperature',
    'rainDays': r'^Mean number of days of rain',
    'cloudyDays': r'^Mean number of cloudy days',
}


def fetch(station: str) -> str:
    url = f'https://www.bom.gov.au/climate/averages/tables/cw_{station}.shtml'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('latin-1')


def parse(page: str) -> dict:
    name = re.search(r'Site name:</strong>&nbsp;\s*([^<]*)', page)
    if not name:
        raise SystemExit('页面里没有站名，可能不是统计表')
    out = {'bom': name.group(1).strip()}
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        cells = [html.unescape(re.sub('<[^>]+>', '', c)).strip() for c in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row, re.S)]
        if not cells:
            continue
        for key, pat in ROWS.items():
            if key not in out and re.search(pat, cells[0]):
                vals = cells[1:13]
                if len(vals) != 12 or not all(re.fullmatch(r'-?\d+(\.\d+)?', v) for v in vals):
                    raise SystemExit(f'{key} 这一行不是 12 个数：{vals}')
                out[key] = [float(v) for v in vals]
    missing = [k for k in ROWS if k not in out]
    if missing:
        raise SystemExit(f'缺少 {missing}')
    return out


if __name__ == '__main__':
    for st in sys.argv[1:]:
        if not re.fullmatch(r'\d{6}', st):
            raise SystemExit(f'站号要 6 位数字：{st}')
        d = parse(fetch(st))
        print(st, d['bom'])
        for k in ROWS:
            print(f'  {k}: {d[k]}')
