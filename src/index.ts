/**
 * 업비트 코인 지표 대시보드
 * - 코인별 거래량 및 RSI 조회
 * - Cloudflare Worker에서 CORS 우회
 */

interface CandleData {
	market: string;
	candle_date_time_utc: string;
	candle_date_time_kst: string;
	opening_price: number;
	high_price: number;
	low_price: number;
	trade_price: number;
	timestamp: number;
	candle_acc_trade_price: number;
	candle_acc_trade_volume: number;
}

interface MarketInfo {
	market: string;
	korean_name: string;
	english_name: string;
}

interface CoinMetrics {
	market: string;
	koreanName: string;
	currentPrice: number;
	volume24h: number;
	rsi: number;
	priceChange24h: number;
	priceChangePercent: number;
}

// RSI 계산 함수 (14 기간)
function calculateRSI(candles: CandleData[], period: number = 14): number {
	if (candles.length < period + 1) return 50; // 데이터 부족시 중립값

	const prices = candles.map((c) => c.trade_price).reverse();

	let gains = 0;
	let losses = 0;

	// 초기 평균 계산
	for (let i = 1; i <= period; i++) {
		const change = prices[i] - prices[i - 1];
		if (change > 0) {
			gains += change;
		} else {
			losses += Math.abs(change);
		}
	}

	const avgGain = gains / period;
	const avgLoss = losses / period;

	if (avgLoss === 0) return 100;

	const rs = avgGain / avgLoss;
	const rsi = 100 - 100 / (1 + rs);

	return Math.round(rsi * 100) / 100;
}

// 업비트 API 호출
async function fetchUpbitAPI(endpoint: string): Promise<any> {
	const response = await fetch(`https://api.upbit.com${endpoint}`, {
		headers: {
			Accept: 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`Upbit API 오류: ${response.status}`);
	}

	return response.json();
}

// 코인 메트릭 조회
async function getCoinMetrics(): Promise<CoinMetrics[]> {
	// 1. KRW 마켓 목록 가져오기
	const markets: MarketInfo[] = await fetchUpbitAPI('/v1/market/all');
	const krwMarkets = markets.filter((m) => m.market.startsWith('KRW-')).slice(0, 30); // 상위 30개

	// 2. 각 코인의 캔들 데이터 가져오기 (병렬 처리)
	const metricsPromises = krwMarkets.map(async (market) => {
		try {
			// 일 캔들로 24시간 데이터 가져오기
			const candles: CandleData[] = await fetchUpbitAPI(`/v1/candles/days?market=${market.market}&count=15`);

			if (candles.length < 2) return null;

			const currentPrice = candles[0].trade_price;
			const volume24h = candles[0].candle_acc_trade_volume;
			const priceYesterday = candles[1].trade_price;
			const priceChange24h = currentPrice - priceYesterday;
			const priceChangePercent = (priceChange24h / priceYesterday) * 100;

			// RSI 계산
			const rsi = calculateRSI(candles);

			return {
				market: market.market,
				koreanName: market.korean_name,
				currentPrice,
				volume24h,
				rsi,
				priceChange24h,
				priceChangePercent,
			} as CoinMetrics;
		} catch (error) {
			console.error(`${market.market} 데이터 가져오기 실패:`, error);
			return null;
		}
	});

	const results = await Promise.all(metricsPromises);
	return results.filter((r): r is CoinMetrics => r !== null);
}

// HTML 대시보드 생성
function generateDashboard(metrics: CoinMetrics[], sortBy: string): string {
	// 정렬
	let sortedMetrics = [...metrics];
	if (sortBy === 'volume') {
		sortedMetrics.sort((a, b) => b.volume24h - a.volume24h);
	} else if (sortBy === 'rsi') {
		sortedMetrics.sort((a, b) => b.rsi - a.rsi);
	} else if (sortBy === 'change') {
		sortedMetrics.sort((a, b) => b.priceChangePercent - a.priceChangePercent);
	}

	const rows = sortedMetrics
		.map((coin, index) => {
			const rsiColor = coin.rsi > 70 ? '#ef4444' : coin.rsi < 30 ? '#3b82f6' : '#6b7280';
			const changeColor = coin.priceChangePercent > 0 ? '#10b981' : '#ef4444';

			return `
			<tr>
				<td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${index + 1}</td>
				<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${coin.koreanName}</td>
				<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">${coin.market}</td>
				<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${coin.currentPrice.toLocaleString()}원</td>
				<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: ${changeColor}; font-weight: 500;">
					${coin.priceChangePercent > 0 ? '+' : ''}${coin.priceChangePercent.toFixed(2)}%
				</td>
				<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${coin.volume24h.toLocaleString(undefined, {
					maximumFractionDigits: 2,
				})}</td>
				<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">
					<span style="background: ${rsiColor}; color: white; padding: 4px 8px; border-radius: 4px; font-weight: 600;">
						${coin.rsi.toFixed(2)}
					</span>
				</td>
			</tr>
		`;
		})
		.join('');

	return `
		<!DOCTYPE html>
		<html lang="ko">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>코인 지표 대시보드</title>
			<style>
				* { margin: 0; padding: 0; box-sizing: border-box; }
				body { 
					font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
					background: #f3f4f6; 
					padding: 20px;
				}
				.container { 
					max-width: 1400px; 
					margin: 0 auto; 
					background: white; 
					border-radius: 12px; 
					box-shadow: 0 1px 3px rgba(0,0,0,0.1);
					overflow: hidden;
				}
				.header { 
					background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
					color: white; 
					padding: 30px;
				}
				.header h1 { font-size: 28px; margin-bottom: 8px; }
				.header p { opacity: 0.9; font-size: 14px; }
				.controls { 
					padding: 20px 30px; 
					background: #f9fafb; 
					border-bottom: 1px solid #e5e7eb;
					display: flex;
					gap: 10px;
					align-items: center;
				}
				.controls label { font-weight: 600; color: #374151; }
				.controls select { 
					padding: 8px 12px; 
					border: 1px solid #d1d5db; 
					border-radius: 6px; 
					font-size: 14px;
					cursor: pointer;
				}
				.controls button {
					padding: 8px 16px;
					background: #667eea;
					color: white;
					border: none;
					border-radius: 6px;
					cursor: pointer;
					font-weight: 600;
					margin-left: auto;
				}
				.controls button:hover { background: #5a67d8; }
				table { width: 100%; border-collapse: collapse; }
				th { 
					background: #f9fafb; 
					padding: 12px; 
					text-align: left; 
					font-weight: 600; 
					color: #374151;
					font-size: 14px;
					border-bottom: 2px solid #e5e7eb;
				}
				th.right, td.right { text-align: right; }
				tr:hover { background: #f9fafb; }
				.legend {
					padding: 20px 30px;
					background: #f9fafb;
					border-top: 1px solid #e5e7eb;
					font-size: 13px;
					color: #6b7280;
				}
				.legend-item {
					display: inline-block;
					margin-right: 20px;
				}
				.legend-item strong { color: #374151; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="header">
					<h1>📊 코인 지표 대시보드</h1>
					<p>업비트 실시간 코인 거래량 및 RSI 지표 분석</p>
				</div>
				
				<div class="controls">
					<label for="sortBy">정렬 기준:</label>
					<select id="sortBy" onchange="location.href='?sort='+this.value">
						<option value="volume" ${sortBy === 'volume' ? 'selected' : ''}>거래량 높은순</option>
						<option value="rsi" ${sortBy === 'rsi' ? 'selected' : ''}>RSI 높은순</option>
						<option value="change" ${sortBy === 'change' ? 'selected' : ''}>변동률 높은순</option>
					</select>
					<button onclick="location.reload()">🔄 새로고침</button>
				</div>

				<table>
					<thead>
						<tr>
							<th style="width: 60px;">#</th>
							<th>코인명</th>
							<th>마켓</th>
							<th class="right">현재가</th>
							<th class="right">24시간 변동</th>
							<th class="right">거래량 (24h)</th>
							<th class="right">RSI (14)</th>
						</tr>
					</thead>
					<tbody>
						${rows}
					</tbody>
				</table>

				<div class="legend">
					<div class="legend-item">
						<strong>RSI 해석:</strong> 
						<span style="color: #ef4444;">70 이상 = 과매수</span>, 
						<span style="color: #3b82f6;">30 이하 = 과매도</span>, 
						<span style="color: #6b7280;">30-70 = 중립</span>
					</div>
					<div class="legend-item">
						<strong>데이터 출처:</strong> 업비트 API
					</div>
				</div>
			</div>
		</body>
		</html>
	`;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		try {
			const url = new URL(request.url);
			const sortBy = url.searchParams.get('sort') || 'volume';

			// API 엔드포인트
			if (url.pathname === '/api/metrics') {
				const metrics = await getCoinMetrics();
				return new Response(JSON.stringify(metrics), {
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					},
				});
			}

			// 대시보드 페이지
			const metrics = await getCoinMetrics();
			const html = generateDashboard(metrics, sortBy);

			return new Response(html, {
				headers: {
					'Content-Type': 'text/html; charset=utf-8',
				},
			});
		} catch (error) {
			return new Response(`오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}`, {
				status: 500,
				headers: { 'Content-Type': 'text/plain; charset=utf-8' },
			});
		}
	},
} satisfies ExportedHandler<Env>;
