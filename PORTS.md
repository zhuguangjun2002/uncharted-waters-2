# 港口数据说明

记录日期：2026-05-28

本文档记录当前项目中的港口数据来源、组织方式、坐标含义，以及全部港口清单。

## 数据放在哪里？

港口基础数据主要放在 [src/data/portData.ts](/home/laozhu/project/uncharted-waters-2/src/data/portData.ts)：

- `regularPorts`：普通港口，共 100 个。
- `supplyPorts`：补给港，共 30 个。
- `SUPPLY_PORT_BUILDINGS`：补给港共用的建筑入口配置。
- `SUPPLY_PORT_TILESET`：补给港共用的港口 tileset。

港口读取和 ID 规则在 [src/game/port/portUtils.ts](/home/laozhu/project/uncharted-waters-2/src/game/port/portUtils.ts)：

- `getPortData(id)`：根据字符串 ID 读取港口。
- `portAdjacentAt(position)`：根据世界地图坐标判断当前位置附近是否有港口。
- `getRegionOrIfSupplyPort(portId)`：普通港返回市场区域，补给港返回 `Supply port`。

## 港口如何组织？

### 普通港口

普通港口使用 `RegularPort` 结构。主要字段包括：

- `name`：港口英文名。当前没有单独维护中文名字段。
- `position`：世界地图 tile 坐标。
- `economy`：经济值。
- `industry`：工业值。
- `allegiances`：六个势力的占有/影响值。
- `regionId`：区域 ID。
- `itemShop`：道具店库存，可能包含隐藏商品 `secret`。
- `marketId`：市场商品/价格区域。
- `industryId`：造船业/船只供应区域。
- `buildings`：港口内建筑入口坐标。
- `tileset`：港口内地图使用的 tileset。

### 补给港

补给港使用 `SupplyPortBase` 结构，只保存：

- `name`：港口英文名。
- `position`：世界地图 tile 坐标。

补给港没有普通港的市场、道具店、造船厂等数据。运行时
`getPortData()` 会给补给港补上共用的 `buildings`、`tileset`、`tilemap` 和
`isSupplyPort: true`。

### 港口 ID

港口 ID 不是写在 `portData.ts` 里的字段，而是由数组顺序推导：

- `regularPorts[0]` 是 ID `1`。
- `regularPorts[99]` 是 ID `100`。
- `supplyPorts[0]` 接在普通港后面，是 ID `101`。
- `supplyPorts[29]` 是 ID `130`。

## 坐标和经纬度如何换算？

源码只保存世界地图 tile 坐标 `x/y`，没有保存真实经纬度字段。当前文档中的经纬度是
根据世界地图尺寸和已知港口位置推导出来的游戏坐标经纬度。

世界地图尺寸：

- 宽度：`2160` tiles。
- 高度：`1080` tiles。
- `x` 方向横向环绕。

经纬度换算：

```ts
longitude = x / 6 - 150;
if (longitude > 180) longitude -= 360;
if (longitude <= -180) longitude += 360;

latitude = 90 - y / 7;
```

这个换算能让 Lisbon、Seville、Barcelona、Cape Town 等港口落在接近真实地理的位置。
但它仍然是游戏地图坐标，不应当当作现代 GIS 精确坐标使用。

## 港口清单

当前数据没有单独维护中文名字段，所以表中的“名称”和“英文名”暂时相同。

| ID | 类型 | 名称 | 英文名 | x | y | 纬度 | 经度 |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | 普通港 | Lisbon | Lisbon | 840 | 358 | 38.86°N | 10.00°W |
| 2 | 普通港 | Seville | Seville | 862 | 372 | 36.86°N | 6.33°W |
| 3 | 普通港 | Istanbul | Istanbul | 1072 | 344 | 40.86°N | 28.67°E |
| 4 | 普通港 | Barcelona | Barcelona | 914 | 342 | 41.14°N | 2.33°E |
| 5 | 普通港 | Algiers | Algiers | 920 | 376 | 36.29°N | 3.33°E |
| 6 | 普通港 | Tunis | Tunis | 962 | 372 | 36.86°N | 10.33°E |
| 7 | 普通港 | Valencia | Valencia | 898 | 356 | 39.14°N | 0.33°W |
| 8 | 普通港 | Marseille | Marseille | 932 | 326 | 43.43°N | 5.33°E |
| 9 | 普通港 | Genoa | Genoa | 950 | 320 | 44.29°N | 8.33°E |
| 10 | 普通港 | Pisa | Pisa | 960 | 328 | 43.14°N | 10.00°E |
| 11 | 普通港 | Naples | Naples | 980 | 348 | 40.29°N | 13.33°E |
| 12 | 普通港 | Syracuse | Syracuse | 990 | 376 | 36.29°N | 15.00°E |
| 13 | 普通港 | Palma | Palma | 916 | 358 | 38.86°N | 2.67°E |
| 14 | 普通港 | Venice | Venice | 978 | 318 | 44.57°N | 13.00°E |
| 15 | 普通港 | Ragusa | Ragusa | 1008 | 338 | 41.71°N | 18.00°E |
| 16 | 普通港 | Candia | Candia | 1050 | 386 | 34.86°N | 25.00°E |
| 17 | 普通港 | Athens | Athens | 1044 | 366 | 37.71°N | 24.00°E |
| 18 | 普通港 | Salonika | Salonika | 1036 | 344 | 40.86°N | 22.67°E |
| 19 | 普通港 | Alexandria | Alexandria | 1078 | 416 | 30.57°N | 29.67°E |
| 20 | 普通港 | Jaffa | Jaffa | 1110 | 410 | 31.43°N | 35.00°E |
| 21 | 普通港 | Beirut | Beirut | 1112 | 402 | 32.57°N | 35.33°E |
| 22 | 普通港 | Nicosia | Nicosia | 1098 | 386 | 34.86°N | 33.00°E |
| 23 | 普通港 | Tripoli | Tripoli | 978 | 406 | 32.00°N | 13.00°E |
| 24 | 普通港 | Kaffa | Kaffa | 1106 | 316 | 44.86°N | 34.33°E |
| 25 | 普通港 | Azov | Azov | 1130 | 302 | 46.86°N | 38.33°E |
| 26 | 普通港 | Trebizond | Trebizond | 1138 | 344 | 40.86°N | 39.67°E |
| 27 | 普通港 | Ceuta | Ceuta | 864 | 384 | 35.14°N | 6.00°W |
| 28 | 普通港 | Bordeaux | Bordeaux | 890 | 314 | 45.14°N | 1.67°W |
| 29 | 普通港 | Nantes | Nantes | 886 | 296 | 47.71°N | 2.33°W |
| 30 | 普通港 | London | London | 900 | 262 | 52.57°N | 0.00°E |
| 31 | 普通港 | Bristol | Bristol | 880 | 264 | 52.29°N | 3.33°W |
| 32 | 普通港 | Dublin | Dublin | 856 | 252 | 54.00°N | 7.33°W |
| 33 | 普通港 | Antwerp | Antwerp | 934 | 258 | 53.14°N | 5.67°E |
| 34 | 普通港 | Amsterdam | Amsterdam | 936 | 248 | 54.57°N | 6.00°E |
| 35 | 普通港 | Copenhagen | Copenhagen | 974 | 230 | 57.14°N | 12.33°E |
| 36 | 普通港 | Hamburg | Hamburg | 960 | 244 | 55.14°N | 10.00°E |
| 37 | 普通港 | Oslo | Oslo | 962 | 190 | 62.86°N | 10.33°E |
| 38 | 普通港 | Stockholm | Stockholm | 1014 | 196 | 62.00°N | 19.00°E |
| 39 | 普通港 | Lubeck | Lubeck | 964 | 242 | 55.43°N | 10.67°E |
| 40 | 普通港 | Danzig | Danzig | 1008 | 240 | 55.71°N | 18.00°E |
| 41 | 普通港 | Riga | Riga | 1042 | 218 | 58.86°N | 23.67°E |
| 42 | 普通港 | Bergen | Bergen | 930 | 192 | 62.57°N | 5.00°E |
| 43 | 普通港 | Caracas | Caracas | 464 | 588 | 6.00°N | 72.67°W |
| 44 | 普通港 | Cartegena | Cartegena | 412 | 592 | 5.43°N | 81.33°W |
| 45 | 普通港 | Havana | Havana | 376 | 502 | 18.29°N | 87.33°W |
| 46 | 普通港 | Margarita | Margarita | 482 | 584 | 6.57°N | 69.67°W |
| 47 | 普通港 | Panama | Panama | 388 | 600 | 4.29°N | 85.33°W |
| 48 | 普通港 | Porto Velho | Porto Velho | 386 | 596 | 4.86°N | 85.67°W |
| 49 | 普通港 | Santo Domingo | Santo Domingo | 454 | 540 | 12.86°N | 74.33°W |
| 50 | 普通港 | Veracruz | Veracruz | 296 | 532 | 14.00°N | 100.67°W |
| 51 | 普通港 | Jamaica | Jamaica | 408 | 542 | 12.57°N | 82.00°W |
| 52 | 普通港 | Guatemala | Guatemala | 328 | 564 | 9.43°N | 95.33°W |
| 53 | 普通港 | Pernambuco | Pernambuco | 624 | 722 | 13.14°S | 46.00°W |
| 54 | 普通港 | Rio de Janeiro | Rio de Janeiro | 594 | 824 | 27.71°S | 51.00°W |
| 55 | 普通港 | Maracaibo | Maracaibo | 434 | 590 | 5.71°N | 77.67°W |
| 56 | 普通港 | Santiago | Santiago | 412 | 526 | 14.86°N | 81.33°W |
| 57 | 普通港 | Cayenne | Cayenne | 556 | 642 | 1.71°S | 57.33°W |
| 58 | 普通港 | Madeira | Madeira | 794 | 402 | 32.57°N | 17.67°W |
| 59 | 普通港 | Santa Cruz | Santa Cruz | 794 | 438 | 27.43°N | 17.67°W |
| 60 | 普通港 | San Jorge | San Jorge | 882 | 596 | 4.86°N | 3.00°W |
| 61 | 普通港 | Bissau | Bissau | 796 | 546 | 12.00°N | 17.33°W |
| 62 | 普通港 | Luanda | Luanda | 974 | 704 | 10.57°S | 12.33°E |
| 63 | 普通港 | Argin | Argin | 790 | 494 | 19.43°N | 18.33°W |
| 64 | 普通港 | Bathurst | Bathurst | 792 | 538 | 13.14°N | 18.00°W |
| 65 | 普通港 | Timbuktu | Timbuktu | 874 | 530 | 14.29°N | 4.33°W |
| 66 | 普通港 | Abidjan | Abidjan | 868 | 594 | 5.14°N | 5.33°W |
| 67 | 普通港 | Sofala | Sofala | 1108 | 762 | 18.86°S | 34.67°E |
| 68 | 普通港 | Malindi | Malindi | 1138 | 662 | 4.57°S | 39.67°E |
| 69 | 普通港 | Mogadishu | Mogadishu | 1174 | 614 | 2.29°N | 45.67°E |
| 70 | 普通港 | Mombasa | Mombasa | 1134 | 670 | 5.71°S | 39.00°E |
| 71 | 普通港 | Mozambique | Mozambique | 1140 | 734 | 14.86°S | 40.00°E |
| 72 | 普通港 | Quelimane | Quelimane | 1120 | 748 | 16.86°S | 36.67°E |
| 73 | 普通港 | Aden | Aden | 1178 | 540 | 12.86°N | 46.33°E |
| 74 | 普通港 | Hormuz | Hormuz | 1240 | 450 | 25.71°N | 56.67°E |
| 75 | 普通港 | Massawa | Massawa | 1146 | 528 | 14.57°N | 41.00°E |
| 76 | 普通港 | Cairo | Cairo | 1096 | 428 | 28.86°N | 32.67°E |
| 77 | 普通港 | Basra | Basra | 1190 | 426 | 29.14°N | 48.33°E |
| 78 | 普通港 | Mecca | Mecca | 1136 | 488 | 20.29°N | 39.33°E |
| 79 | 普通港 | Quatar | Quatar | 1216 | 458 | 24.57°N | 52.67°E |
| 80 | 普通港 | Shiraz | Shiraz | 1222 | 450 | 25.71°N | 53.67°E |
| 81 | 普通港 | Muscat | Muscat | 1252 | 464 | 23.71°N | 58.67°E |
| 82 | 普通港 | Diu | Diu | 1296 | 458 | 24.57°N | 66.00°E |
| 83 | 普通港 | Cochin | Cochin | 1352 | 562 | 9.71°N | 75.33°E |
| 84 | 普通港 | Ceylon | Ceylon | 1380 | 576 | 7.71°N | 80.00°E |
| 85 | 普通港 | Amboa | Amboa | 1654 | 652 | 3.14°S | 125.67°E |
| 86 | 普通港 | Goa | Goa | 1342 | 536 | 13.43°N | 73.67°E |
| 87 | 普通港 | Malacca | Malacca | 1506 | 606 | 3.43°N | 101.00°E |
| 88 | 普通港 | Ternate | Ternate | 1654 | 622 | 1.14°N | 125.67°E |
| 89 | 普通港 | Banda | Banda | 1668 | 660 | 4.29°S | 128.00°E |
| 90 | 普通港 | Dili | Dili | 1654 | 684 | 7.71°S | 125.67°E |
| 91 | 普通港 | Pasei | Pasei | 1480 | 604 | 3.71°N | 96.67°E |
| 92 | 普通港 | Sunda | Sunda | 1540 | 666 | 5.14°S | 106.67°E |
| 93 | 普通港 | Calicut | Calicut | 1348 | 552 | 11.14°N | 74.67°E |
| 94 | 普通港 | Bankao | Bankao | 1530 | 628 | 0.29°N | 105.00°E |
| 95 | 普通港 | Zeiton | Zeiton | 1614 | 454 | 25.14°N | 119.00°E |
| 96 | 普通港 | Macao | Macao | 1582 | 474 | 22.29°N | 113.67°E |
| 97 | 普通港 | Hanoi | Hanoi | 1532 | 482 | 21.14°N | 105.33°E |
| 98 | 普通港 | Changan | Changan | 1560 | 388 | 34.57°N | 110.00°E |
| 99 | 普通港 | Sakai | Sakai | 1716 | 390 | 34.29°N | 136.00°E |
| 100 | 普通港 | Nagasaki | Nagasaki | 1676 | 402 | 32.57°N | 129.33°E |
| 101 | 补给港 | Hekla | Hekla | 784 | 210 | 60.00°N | 19.33°W |
| 102 | 补给港 | Narvik | Narvik | 998 | 114 | 73.71°N | 16.33°E |
| 103 | 补给港 | Cape Town | Cape Town | 1006 | 860 | 32.86°S | 17.67°E |
| 104 | 补给港 | Belgrade | Belgrade | 1012 | 312 | 45.43°N | 18.67°E |
| 105 | 补给港 | Tamatave | Tamatave | 1192 | 758 | 18.29°S | 48.67°E |
| 106 | 补给港 | Dikson | Dikson | 1386 | 60 | 81.43°N | 81.00°E |
| 107 | 补给港 | Lushun | Lushun | 1632 | 360 | 38.57°N | 122.00°E |
| 108 | 补给港 | Leveque | Leveque | 1652 | 716 | 12.29°S | 125.33°E |
| 109 | 补给港 | Mindanao | Mindanao | 1656 | 578 | 7.43°N | 126.00°E |
| 110 | 补给港 | Tiksi | Tiksi | 1676 | 78 | 78.86°N | 129.33°E |
| 111 | 补给港 | Ezo | Ezo | 1740 | 334 | 42.29°N | 140.00°E |
| 112 | 补给港 | Geelong | Geelong | 1748 | 884 | 36.29°S | 141.33°E |
| 113 | 补给港 | Guam | Guam | 1758 | 538 | 13.14°N | 143.00°E |
| 114 | 补给港 | Moresby | Moresby | 1770 | 686 | 8.00°S | 145.00°E |
| 115 | 补给港 | Korf | Korf | 1880 | 200 | 61.43°N | 163.33°E |
| 116 | 补给港 | Wanganui | Wanganui | 1930 | 900 | 38.57°S | 171.67°E |
| 117 | 补给港 | Suva | Suva | 1960 | 738 | 15.43°S | 176.67°E |
| 118 | 补给港 | Nome | Nome | 2062 | 156 | 67.71°N | 166.33°W |
| 119 | 补给港 | Naalehu | Naalehu | 2120 | 498 | 18.86°N | 156.67°W |
| 120 | 补给港 | Tahiti | Tahiti | 2134 | 732 | 14.57°S | 154.33°W |
| 121 | 补给港 | Juneau | Juneau | 70 | 228 | 57.43°N | 138.33°W |
| 122 | 补给港 | Coppermine | Coppermine | 152 | 122 | 72.57°N | 124.67°W |
| 123 | 补给港 | Santa Barbara | Santa Barbara | 174 | 448 | 26.00°N | 121.00°W |
| 124 | 补给港 | Churchill | Churchill | 330 | 242 | 55.43°N | 95.00°W |
| 125 | 补给港 | Callao | Callao | 394 | 724 | 13.43°S | 84.33°W |
| 126 | 补给港 | Valparaiso | Valparaiso | 424 | 892 | 37.43°S | 79.33°W |
| 127 | 补给港 | Mollendo | Mollendo | 430 | 778 | 21.14°S | 78.33°W |
| 128 | 补给港 | Cape Cod | Cape Cod | 466 | 372 | 36.86°N | 72.33°W |
| 129 | 补给港 | Montevideo | Montevideo | 516 | 906 | 39.43°S | 64.00°W |
| 130 | 补给港 | Forel | Forel | 660 | 190 | 62.86°N | 40.00°W |
