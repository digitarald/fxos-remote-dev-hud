var path = require('path');
var webpack = require('webpack');

module.exports = {
	cache: true,
	watch: true,
	debug: true,
	entry: {
		main: './static/index.jsx'
	},
	output: {
		path: path.join(__dirname, 'static'),
		filename: 'build.js',
		publicPath: '/'
	},
	resolve: {
		modulesDirectories: ['node_modules'],
	},
	module: {
		loaders: [{
			test: /\.jsx$/,
			loader: 'babel-loader'
		}, {
			test: /\.styl$/,
			loader: 'style-loader!css-loader!autoprefixer-loader?browsers=last 1 version!stylus-loader'
		}]
	}
};